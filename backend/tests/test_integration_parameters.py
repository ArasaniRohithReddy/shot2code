"""Run identity travels through the pipeline intact.

``modelSelections`` names a runtime per pick, order and identity survive to the
websocket, a native pick is never re-routed, and a retry replays identity while
using the settings the current request carries.
"""

from typing import Any, cast
from unittest.mock import AsyncMock

import pytest

from integrations.config import IntegrationConfigError, byok_selection_id
from llm import Llm
from model_catalog import (
    ModelRunSpec,
    ProviderCredentials,
    build_catalog,
    parse_model_selections,
)
from routes.generate_code import (
    AgenticGenerationStage,
    ModelSelectionStage,
    ParameterExtractionStage,
)

OPENAI_BASE = Llm.GPT_5_6_SOL_HIGH
ANTHROPIC_BASE = Llm.CLAUDE_OPUS_5_MAX
AZURE_ID = byok_selection_id("azure", OPENAI_BASE)


def byok_block(**overrides: object) -> dict[str, object]:
    block: dict[str, object] = {
        "enabled": True,
        "provider": "azure",
        "baseUrl": "https://res.openai.azure.com",
        "apiKey": "azure-secret",
    }
    block.update(overrides)
    return block


def base_params(**extra: object) -> dict[str, Any]:
    params: dict[str, Any] = {
        "generatedCodeConfig": "html_tailwind",
        "inputMode": "text",
        "prompt": {"text": "hello"},
    }
    params.update(extra)
    return params


def selection(identity: str, base: Llm, runtime: str) -> dict[str, object]:
    return {"id": identity, "baseModel": base.value, "runtime": runtime}


def trusted_server(**fields: object) -> dict[str, object]:
    server: dict[str, object] = {
        "id": "docs",
        "name": "Docs",
        "enabled": True,
        "trusted": True,
        "transport": "stdio",
        "command": "npx",
        "env": {"DOCS_TOKEN": "tok-secret"},
    }
    server.update(fields)
    return server


class TestSelectionParsing:
    def test_a_structured_entry_carries_its_runtime(self) -> None:
        specs, unknown = parse_model_selections(
            [selection(AZURE_ID, OPENAI_BASE, "copilot-byok")]
        )

        assert unknown == ()
        assert specs[0].selection_id == AZURE_ID
        assert specs[0].runtime == "copilot-byok"
        assert specs[0].model is OPENAI_BASE

    def test_native_entries_keep_the_direct_id(self) -> None:
        specs, _ = parse_model_selections(
            [selection(OPENAI_BASE.value, OPENAI_BASE, "native")]
        )

        assert specs[0].selection_id == OPENAI_BASE.value
        assert specs[0].runtime == "native"
        assert specs[0].is_byok is False

    def test_the_same_base_model_survives_twice_under_two_runtimes(self) -> None:
        specs, _ = parse_model_selections(
            [
                selection(OPENAI_BASE.value, OPENAI_BASE, "native"),
                selection(AZURE_ID, OPENAI_BASE, "copilot-byok"),
            ]
        )

        assert [spec.selection_id for spec in specs] == [OPENAI_BASE.value, AZURE_ID]
        assert specs[0].model is specs[1].model

    def test_order_is_preserved_across_runtimes(self) -> None:
        specs, _ = parse_model_selections(
            [
                selection(AZURE_ID, OPENAI_BASE, "copilot-byok"),
                selection(ANTHROPIC_BASE.value, ANTHROPIC_BASE, "native"),
                selection(OPENAI_BASE.value, OPENAI_BASE, "native"),
            ]
        )

        assert [spec.selection_id for spec in specs] == [
            AZURE_ID,
            ANTHROPIC_BASE.value,
            OPENAI_BASE.value,
        ]

    def test_exact_duplicates_collapse_but_different_identities_do_not(self) -> None:
        specs, _ = parse_model_selections(
            [
                selection(OPENAI_BASE.value, OPENAI_BASE, "native"),
                selection(OPENAI_BASE.value, OPENAI_BASE, "native"),
                selection(AZURE_ID, OPENAI_BASE, "copilot-byok"),
            ]
        )

        assert [spec.selection_id for spec in specs] == [OPENAI_BASE.value, AZURE_ID]

    def test_legacy_string_ids_still_work(self) -> None:
        specs, unknown = parse_model_selections([OPENAI_BASE.value, AZURE_ID, "ghost"])

        assert [(s.selection_id, s.runtime) for s in specs] == [
            (OPENAI_BASE.value, "native"),
            (AZURE_ID, "copilot-byok"),
        ]
        assert unknown == ("ghost",)

    def test_a_byok_entry_without_a_parsable_identity_is_reported(self) -> None:
        specs, unknown = parse_model_selections(
            [{"id": "sdk-byok/nonsense", "baseModel": OPENAI_BASE.value,
              "runtime": "copilot-byok"}]
        )

        assert specs == ()
        assert unknown == ("sdk-byok/nonsense",)

    def test_an_unknown_base_model_is_reported(self) -> None:
        specs, unknown = parse_model_selections(
            [{"id": "gpt-9000", "baseModel": "gpt-9000", "runtime": "native"}]
        )

        assert specs == ()
        assert unknown == ("gpt-9000",)


class TestParameterExtraction:
    @pytest.mark.asyncio
    async def test_a_request_without_integrations_gets_empty_settings(self) -> None:
        stage = ParameterExtractionStage(AsyncMock())

        extracted = await stage.extract_and_validate(base_params())

        assert extracted.integrations.byok is None
        assert extracted.integrations.mcp_servers == ()
        assert extracted.selected_specs == []

    @pytest.mark.asyncio
    async def test_model_selections_are_carried_with_their_runtimes(self) -> None:
        stage = ParameterExtractionStage(AsyncMock())

        extracted = await stage.extract_and_validate(
            base_params(
                copilotSdkByok=byok_block(),
                mcpServers=[trusted_server()],
                modelSelections=[
                    selection(OPENAI_BASE.value, OPENAI_BASE, "native"),
                    selection(AZURE_ID, OPENAI_BASE, "copilot-byok"),
                ],
            )
        )

        assert [(s.selection_id, s.runtime) for s in extracted.selected_specs] == [
            (OPENAI_BASE.value, "native"),
            (AZURE_ID, "copilot-byok"),
        ]
        connection = extracted.integrations.byok
        assert connection is not None
        assert connection.api_key == "azure-secret"
        assert [s.key for s in extracted.integrations.active_mcp_servers] == ["docs"]

    @pytest.mark.asyncio
    async def test_legacy_selected_models_still_work(self) -> None:
        stage = ParameterExtractionStage(AsyncMock())

        extracted = await stage.extract_and_validate(
            base_params(selectedModels=[OPENAI_BASE.value, ANTHROPIC_BASE.value])
        )

        assert extracted.selected_models == [OPENAI_BASE, ANTHROPIC_BASE]
        assert all(not spec.is_byok for spec in extracted.selected_specs)

    @pytest.mark.asyncio
    async def test_model_selections_win_over_the_legacy_field(self) -> None:
        stage = ParameterExtractionStage(AsyncMock())

        extracted = await stage.extract_and_validate(
            base_params(
                copilotSdkByok=byok_block(),
                modelSelections=[selection(AZURE_ID, OPENAI_BASE, "copilot-byok")],
                selectedModels=[ANTHROPIC_BASE.value],
            )
        )

        assert [s.selection_id for s in extracted.selected_specs] == [AZURE_ID]

    @pytest.mark.asyncio
    async def test_a_malformed_configuration_stops_the_run_with_an_explanation(
        self,
    ) -> None:
        throw_error = AsyncMock()
        stage = ParameterExtractionStage(throw_error)

        with pytest.raises(IntegrationConfigError):
            await stage.extract_and_validate(
                base_params(
                    mcpServers=[trusted_server(transport="http", command=None, url="")]
                )
            )

        throw_error.assert_awaited_once()
        message = cast(str, throw_error.await_args.args[0])  # pyright: ignore[reportOptionalMemberAccess]
        assert "url" in message

    @pytest.mark.asyncio
    async def test_a_retry_replays_identity_with_current_settings(self) -> None:
        stage = ParameterExtractionStage(AsyncMock())

        extracted = await stage.extract_and_validate(
            base_params(
                retryModelSelections=[
                    selection(OPENAI_BASE.value, OPENAI_BASE, "native"),
                    selection(AZURE_ID, OPENAI_BASE, "copilot-byok"),
                ],
                copilotSdkByok=byok_block(apiKey="azure-rotated"),
            )
        )

        assert extracted.retry_specs is not None
        assert [s.selection_id for s in extracted.retry_specs] == [
            OPENAI_BASE.value,
            AZURE_ID,
        ]
        connection = extracted.integrations.byok_for(AZURE_ID)
        assert connection is not None
        assert connection.api_key == "azure-rotated"

    @pytest.mark.asyncio
    async def test_legacy_retry_models_still_work(self) -> None:
        stage = ParameterExtractionStage(AsyncMock())

        extracted = await stage.extract_and_validate(
            base_params(retryModels=[OPENAI_BASE.value, AZURE_ID])
        )

        assert extracted.retry_specs is not None
        assert [s.runtime for s in extracted.retry_specs] == [
            "native",
            "copilot-byok",
        ]


class TestSelectionStage:
    def catalog_with_byok(self, **credentials: object):
        from integrations.config import parse_integration_settings

        settings = parse_integration_settings({"copilotSdkByok": byok_block()})
        return (
            build_catalog(
                ProviderCredentials(byok=settings.byok_summary, **credentials)  # pyright: ignore[reportArgumentType]
            ),
            settings,
        )

    @pytest.mark.asyncio
    async def test_both_runtimes_survive_filtering(self) -> None:
        catalog, _ = self.catalog_with_byok(openai_api_key="sk-direct")
        specs, _ = parse_model_selections(
            [
                selection(OPENAI_BASE.value, OPENAI_BASE, "native"),
                selection(AZURE_ID, OPENAI_BASE, "copilot-byok"),
            ]
        )

        result = await ModelSelectionStage(AsyncMock()).select_models(
            generation_type="create",
            input_mode="image",
            selected_specs=specs,
            catalog=catalog,
        )

        assert result.selection_ids == [OPENAI_BASE.value, AZURE_ID]
        assert [spec.runtime for spec in result.specs] == ["native", "copilot-byok"]

    @pytest.mark.asyncio
    async def test_an_unusable_connection_drops_only_the_byok_pick(self) -> None:
        from integrations.config import parse_integration_settings

        settings = parse_integration_settings(
            {"copilotSdkByok": byok_block(apiKey=None)}
        )
        catalog = build_catalog(
            ProviderCredentials(
                openai_api_key="sk-direct", byok=settings.byok_summary
            )
        )
        specs, _ = parse_model_selections(
            [
                selection(OPENAI_BASE.value, OPENAI_BASE, "native"),
                selection(AZURE_ID, OPENAI_BASE, "copilot-byok"),
            ]
        )

        result = await ModelSelectionStage(AsyncMock()).select_models(
            generation_type="create",
            input_mode="image",
            selected_specs=specs,
            byok_reason=(
                settings.byok_summary.reason if settings.byok_summary else None
            ),
            catalog=catalog,
        )

        assert result.selection_ids == [OPENAI_BASE.value]
        assert result.dropped == [AZURE_ID]
        assert "API key" in " ".join(result.notices)

    @pytest.mark.asyncio
    async def test_automatic_selection_is_always_native(self) -> None:
        catalog, _ = self.catalog_with_byok(openai_api_key="sk-direct")

        result = await ModelSelectionStage(AsyncMock()).select_models(
            generation_type="create",
            input_mode="image",
            catalog=catalog,
        )

        assert result.specs
        assert all(spec.runtime == "native" for spec in result.specs)

    @pytest.mark.asyncio
    async def test_byok_is_not_offered_for_video(self) -> None:
        catalog, _ = self.catalog_with_byok(gemini_api_key="gem-1")
        specs, _ = parse_model_selections(
            [selection(AZURE_ID, OPENAI_BASE, "copilot-byok")]
        )

        result = await ModelSelectionStage(AsyncMock()).select_models(
            generation_type="create",
            input_mode="video",
            selected_specs=specs,
            catalog=catalog,
        )

        assert "cannot read video" in " ".join(result.notices)


class TestGenerationStageHandoff:
    def stage(self, **kwargs: object) -> AgenticGenerationStage:
        return AgenticGenerationStage(
            send_message=AsyncMock(),
            openai_api_key=None,
            openai_base_url=None,
            anthropic_api_key=None,
            gemini_api_key=None,
            replicate_api_key=None,
            should_generate_images=False,
            file_state=None,
            asset_base_url="",
            option_codes=[],
            **kwargs,  # pyright: ignore[reportArgumentType]
        )

    def test_a_native_spec_resolves_to_no_connection(self) -> None:
        from integrations.config import parse_integration_settings

        settings = parse_integration_settings({"copilotSdkByok": byok_block()})
        stage = self.stage(integrations=settings)

        assert stage._byok_connection_for(  # pyright: ignore[reportPrivateUsage]
            ModelRunSpec.native(OPENAI_BASE)
        ) is None

    def test_a_byok_spec_resolves_to_the_connection(self) -> None:
        from integrations.config import parse_integration_settings

        settings = parse_integration_settings({"copilotSdkByok": byok_block()})
        stage = self.stage(integrations=settings)

        connection = stage._byok_connection_for(  # pyright: ignore[reportPrivateUsage]
            ModelRunSpec.byok("azure", OPENAI_BASE)
        )

        assert connection is not None
        assert connection.api_key == "azure-secret"

    def test_a_vanished_connection_fails_that_variant_with_a_clear_message(
        self,
    ) -> None:
        stage = self.stage()

        with pytest.raises(ValueError) as excinfo:
            stage._byok_connection_for(  # pyright: ignore[reportPrivateUsage]
                ModelRunSpec.byok("azure", OPENAI_BASE)
            )

        assert AZURE_ID in str(excinfo.value)


class TestSecretsStayOutOfRecords:
    @pytest.mark.asyncio
    async def test_safe_metadata_of_extracted_settings_has_no_secrets(self) -> None:
        stage = ParameterExtractionStage(AsyncMock())

        extracted = await stage.extract_and_validate(
            base_params(
                openAiApiKey="sk-direct-openai",
                copilotSdkByok=byok_block(),
                mcpServers=[
                    trusted_server(),
                    {
                        "id": "remote",
                        "name": "Remote",
                        "enabled": True,
                        "trusted": True,
                        "transport": "http",
                        "url": "https://mcp.example.com",
                        "headers": {"Authorization": "Bearer header-secret"},
                    },
                ],
            )
        )

        rendered = repr(extracted.integrations.safe_metadata())

        for secret in (
            "azure-secret",
            "tok-secret",
            "header-secret",
            "sk-direct-openai",
        ):
            assert secret not in rendered

    def test_history_records_carry_no_integration_fields(self) -> None:
        from history.models import VersionInput

        assert "integrations" not in VersionInput.model_fields
        assert "copilotSdkByok" not in VersionInput.model_fields
        assert "mcpServers" not in VersionInput.model_fields

    def test_the_run_recorder_never_receives_integration_settings(self) -> None:
        from fs_logging.agent_runs import AgentRunRecorder

        recorder_fields = AgentRunRecorder.__init__.__code__.co_varnames
        assert "integrations" not in recorder_fields
        assert "byok_connection" not in recorder_fields
