"""A standards-compatible endpoint serving a model of its operator's choosing.

The generic case: any HTTPS base URL, a dedicated key or bearer token, and one
model name the catalog has never heard of. Nothing here is specific to a
vendor, a region or a hostname. These tests pin the four things that make it
honest: one truthful catalog entry, a collision-safe identity that survives
history and retries, the real model name on the wire, and no reasoning-effort
setting leaking to a model that has no such concept.
"""

from typing import Any, cast
from urllib.parse import quote

import pytest

from agent.providers.factory import create_provider_session
from agent.providers.github_copilot import CopilotProviderSession
from agent.providers.openai import OpenAIProviderSession
from integrations.config import (
    ByokConnection,
    IntegrationConfigError,
    byok_custom_selection_id,
    byok_selection_id,
    is_valid_wire_model,
    neutral_base_model,
    parse_byok_selection_id,
    parse_integration_settings,
)
from integrations.copilot_sdk import build_provider_config
from llm import Llm, get_model_effort
from model_catalog import (
    ProviderCredentials,
    ModelRunSpec,
    ProviderCredentials,
    build_catalog,
    parse_model_selections,
)

CUSTOM_MODEL = "custom-vision-model"
BASE_URL = "https://models.example.org/v1"
CUSTOM_ID = f"sdk-byok/openai/custom/{CUSTOM_MODEL}"
OPENAI_BASE = Llm.GPT_5_6_SOL_HIGH

PROMPT: list[dict[str, Any]] = [
    {"role": "system", "content": "You are a test."},
    {"role": "user", "content": "Build a page."},
]


def custom_block(**overrides: object) -> dict[str, object]:
    block: dict[str, object] = {
        "enabled": True,
        "provider": "openai",
        "baseUrl": BASE_URL,
        "apiKey": "endpoint-secret-value",
        "wireModel": CUSTOM_MODEL,
    }
    block.update(overrides)
    return block


def settings_for(**overrides: object):
    return parse_integration_settings({"copilotSdkByok": custom_block(**overrides)})


def connection_of(**overrides: object) -> ByokConnection:
    connection = settings_for(**overrides).byok
    assert connection is not None
    return connection


class TestCustomIdentity:
    def test_the_identity_names_the_real_model(self) -> None:
        assert byok_custom_selection_id("openai", CUSTOM_MODEL) == CUSTOM_ID

    def test_the_identity_round_trips(self) -> None:
        parsed = parse_byok_selection_id(CUSTOM_ID)

        assert parsed is not None
        assert parsed.provider == "openai"
        assert parsed.wire_model == CUSTOM_MODEL
        assert parsed.is_custom is True
        assert parsed.display_model == CUSTOM_MODEL
        assert parsed.selection_id == CUSTOM_ID

    @pytest.mark.parametrize(
        "wire_model",
        ["vendor/model-name", "model:tag-1", "model@2026-01-01", "other-custom-model"],
    )
    def test_slashes_and_colons_survive_encoding(self, wire_model: str) -> None:
        identity = byok_custom_selection_id("openai", wire_model)
        parsed = parse_byok_selection_id(identity)

        assert quote(wire_model, safe="") in identity
        assert parsed is not None
        assert parsed.wire_model == wire_model

    def test_a_custom_id_cannot_collide_with_a_known_model_id(self) -> None:
        known = byok_selection_id("openai", OPENAI_BASE)

        assert CUSTOM_ID != known
        assert "/custom/" in CUSTOM_ID
        assert "/custom/" not in known
        # A model literally named "custom" still encodes to a distinct id.
        assert byok_custom_selection_id("openai", "custom") != CUSTOM_ID

    def test_known_model_ids_still_parse(self) -> None:
        """Ids saved before custom endpoints existed keep working."""
        parsed = parse_byok_selection_id(byok_selection_id("openai", OPENAI_BASE))

        assert parsed is not None
        assert parsed.is_custom is False
        assert parsed.base_model is OPENAI_BASE

    @pytest.mark.parametrize(
        "value",
        ["sdk-byok/openai/custom/", "sdk-byok/openai/custom", "sdk-byok/bad/custom/x"],
    )
    def test_malformed_custom_ids_do_not_parse(self, value: str) -> None:
        assert parse_byok_selection_id(value) is None

    @pytest.mark.parametrize(
        "value", ["has space", "", "x" * 200, "-leading", "tab\there"]
    )
    def test_unusable_model_names_are_refused(self, value: str) -> None:
        assert is_valid_wire_model(value) is False

    def test_an_unusable_wire_model_is_refused_at_parse_time(self) -> None:
        with pytest.raises(IntegrationConfigError) as excinfo:
            settings_for(wireModel="not a model")

        assert "endpoint model name" in str(excinfo.value)


class TestCatalogHonesty:
    def test_one_entry_named_for_the_real_model(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(byok=settings_for().byok_summary)
        )

        byok = next(p for p in catalog.providers if p.id == "sdk-byok")
        assert len(byok.models) == 1, "one endpoint model means one entry"
        entry = byok.models[0]
        assert entry.id == CUSTOM_ID
        assert CUSTOM_MODEL in entry.label
        assert entry.wire_model == CUSTOM_MODEL
        assert entry.runtime == "copilot-byok"

    def test_no_gpt_aliases_are_invented_for_a_custom_endpoint(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(byok=settings_for().byok_summary)
        )

        labels = [m.label for m in next(
            p for p in catalog.providers if p.id == "sdk-byok"
        ).models]
        assert not any("GPT" in label for label in labels)

    def test_a_custom_entry_advertises_no_thinking_level(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(byok=settings_for().byok_summary)
        )

        entry = next(p for p in catalog.providers if p.id == "sdk-byok").models[0]
        assert entry.effort is None

    def test_without_a_wire_model_the_family_is_still_offered(self) -> None:
        """A vendor endpoint really does host the family; that stays true."""
        catalog = build_catalog(
            ProviderCredentials(byok=settings_for(wireModel=None).byok_summary)
        )

        models = next(p for p in catalog.providers if p.id == "sdk-byok").models
        assert len(models) > 1
        assert all("/custom/" not in model.id for model in models)

    def test_the_native_providers_are_untouched_by_a_custom_endpoint(self) -> None:
        without = build_catalog(ProviderCredentials(openai_api_key="sk-direct"))
        with_custom = build_catalog(
            ProviderCredentials(
                openai_api_key="sk-direct", byok=settings_for().byok_summary
            )
        )

        for provider_id in ("openai", "anthropic", "gemini", "copilot"):
            before = next(p for p in without.providers if p.id == provider_id)
            after = next(p for p in with_custom.providers if p.id == provider_id)
            assert before.available == after.available
            assert [m.id for m in before.models] == [m.id for m in after.models]


class TestSelectionRoundTrip:
    def test_the_identity_survives_a_selection(self) -> None:
        specs, unknown = parse_model_selections([CUSTOM_ID])

        assert unknown == ()
        assert specs[0].selection_id == CUSTOM_ID
        assert specs[0].wire_model == CUSTOM_MODEL
        assert specs[0].is_custom_model is True
        assert specs[0].model is neutral_base_model("openai")

    def test_a_structured_selection_carries_the_wire_model(self) -> None:
        specs, _ = parse_model_selections(
            [
                {
                    "id": CUSTOM_ID,
                    "baseModel": OPENAI_BASE.value,
                    "runtime": "copilot-byok",
                    "wireModel": CUSTOM_MODEL,
                }
            ]
        )

        # The identity is authoritative: the neutral template wins over a
        # baseModel the client guessed.
        assert specs[0].wire_model == CUSTOM_MODEL
        assert specs[0].model is neutral_base_model("openai")

    def test_a_selection_without_an_identity_can_still_name_the_endpoint_model(
        self,
    ) -> None:
        specs, unknown = parse_model_selections(
            [{"runtime": "copilot-byok", "provider": "openai", "wireModel": CUSTOM_MODEL}]
        )

        assert unknown == ()
        assert specs[0].selection_id == CUSTOM_ID

    def test_native_and_custom_selections_coexist(self) -> None:
        specs, _ = parse_model_selections([OPENAI_BASE.value, CUSTOM_ID])

        assert [s.selection_id for s in specs] == [OPENAI_BASE.value, CUSTOM_ID]
        assert [s.runtime for s in specs] == ["native", "copilot-byok"]
        assert specs[0].wire_model is None
        assert specs[1].wire_model == CUSTOM_MODEL

    def test_a_retry_replays_the_custom_identity(self) -> None:
        """History stores the id; a retry must send the same one back."""
        persisted = ModelRunSpec.byok_custom("openai", CUSTOM_MODEL).selection_id
        replayed, unknown = parse_model_selections([persisted])

        assert unknown == ()
        assert replayed[0].selection_id == persisted
        assert replayed[0].wire_model == CUSTOM_MODEL

    def test_a_stale_identity_no_longer_resolves(self) -> None:
        """The endpoint was repointed, so the old model must not run."""
        settings = settings_for(wireModel="other-custom-model")

        assert settings.byok_selection_for(CUSTOM_ID) is None
        assert settings.byok_for(CUSTOM_ID) is None

    def test_the_current_identity_resolves_to_its_connection(self) -> None:
        settings = settings_for()

        selection = settings.byok_selection_for(CUSTOM_ID)
        assert selection is not None
        assert selection.wire_model == CUSTOM_MODEL
        assert settings.byok_for(CUSTOM_ID) is not None


class TestWireContract:
    def test_the_endpoint_model_is_what_goes_on_the_wire(self) -> None:
        config = cast(
            dict[str, Any],
            build_provider_config(
                connection_of(), neutral_base_model("openai"), wire_model=CUSTOM_MODEL
            ),
        )

        assert config["wire_model"] == CUSTOM_MODEL
        assert config["base_url"] == BASE_URL
        assert config["type"] == "openai"
        # model_id stays a name the runtime knows - a template, not a claim.
        assert config["model_id"] == "gpt-5.5"

    def test_the_selection_wire_model_wins_over_the_connection(self) -> None:
        config = cast(
            dict[str, Any],
            build_provider_config(
                connection_of(wireModel="other-model"),
                neutral_base_model("openai"),
                wire_model=CUSTOM_MODEL,
            ),
        )

        assert config["wire_model"] == CUSTOM_MODEL

    def test_the_dedicated_credential_is_the_only_one_sent(self) -> None:
        config = cast(
            dict[str, Any],
            build_provider_config(
                connection_of(), neutral_base_model("openai"), wire_model=CUSTOM_MODEL
            ),
        )

        assert config["api_key"] == "endpoint-secret-value"


class TestNoReasoningEffortLeakage:
    def session_for(self, spec: ModelRunSpec) -> CopilotProviderSession:
        settings = settings_for()
        connection = settings.byok_for(spec.selection_id)
        assert connection is not None
        session = create_provider_session(
            model=spec.model,
            prompt_messages=PROMPT,  # pyright: ignore[reportArgumentType]
            should_generate_images=False,
            openai_api_key="sk-direct",
            openai_base_url=None,
            anthropic_api_key=None,
            gemini_api_key=None,
            replicate_api_key=None,
            integrations=settings,
            byok_connection=connection,
            byok_wire_model=spec.wire_model,
        )
        assert isinstance(session, CopilotProviderSession)
        return session

    def test_the_neutral_template_has_no_thinking_level(self) -> None:
        assert get_model_effort(neutral_base_model("openai")) in (None, "none")

    @pytest.mark.asyncio
    async def test_no_reasoning_effort_reaches_a_custom_model(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        session = self.session_for(ModelRunSpec.byok_custom("openai", CUSTOM_MODEL))
        captured: dict[str, Any] = {}

        async def fake_start() -> None:
            return None

        async def fake_create_session(**kwargs: Any) -> object:
            captured.update(kwargs)
            return object()

        monkeypatch.setattr(session._client, "start", fake_start)  # pyright: ignore[reportPrivateUsage]
        monkeypatch.setattr(
            session._client, "create_session", fake_create_session  # pyright: ignore[reportPrivateUsage]
        )

        await session._ensure_session()  # pyright: ignore[reportPrivateUsage]

        assert "reasoning_effort" not in captured
        assert captured["provider"]["wire_model"] == CUSTOM_MODEL
        assert captured["model"] == "gpt-5.5"

    def test_the_session_is_built_with_effort_disabled(self) -> None:
        session = self.session_for(ModelRunSpec.byok_custom("openai", CUSTOM_MODEL))

        assert session._allow_reasoning_effort is False  # pyright: ignore[reportPrivateUsage]
        assert session._reasoning_effort is None  # pyright: ignore[reportPrivateUsage]

    def test_a_known_model_selection_keeps_its_effort_handling(self) -> None:
        settings = settings_for(wireModel=None)
        connection = settings.usable_byok
        assert connection is not None
        session = create_provider_session(
            model=OPENAI_BASE,
            prompt_messages=PROMPT,  # pyright: ignore[reportArgumentType]
            should_generate_images=False,
            openai_api_key=None,
            openai_base_url=None,
            anthropic_api_key=None,
            gemini_api_key=None,
            replicate_api_key=None,
            integrations=settings,
            byok_connection=connection,
        )

        assert isinstance(session, CopilotProviderSession)
        assert session._allow_reasoning_effort is True  # pyright: ignore[reportPrivateUsage]

    def test_a_native_pick_is_untouched_by_a_custom_endpoint(self) -> None:
        settings = settings_for()

        session = create_provider_session(
            model=OPENAI_BASE,
            prompt_messages=PROMPT,  # pyright: ignore[reportArgumentType]
            should_generate_images=False,
            openai_api_key="sk-direct",
            openai_base_url=None,
            anthropic_api_key=None,
            gemini_api_key=None,
            replicate_api_key=None,
            integrations=settings,
        )

        assert isinstance(session, OpenAIProviderSession)

    def test_a_deployment_named_after_a_model_family_stays_neutral(self) -> None:
        """`gpt-5.5` is an API name, not a thinking level.

        The neutral template already resolves to ``gpt-5.5`` on the wire, so a
        deployment called that is served correctly without shot2code inventing
        one of the five effort variants the user never picked.
        """
        settings = settings_for(wireModel="gpt-5.5")
        connection = settings.usable_byok
        assert connection is not None
        selection = connection.custom_selection
        assert selection is not None
        assert selection.base_model is neutral_base_model("openai")

        session = create_provider_session(
            model=selection.base_model,
            prompt_messages=PROMPT,  # pyright: ignore[reportArgumentType]
            should_generate_images=False,
            openai_api_key=None,
            openai_base_url=None,
            anthropic_api_key=None,
            gemini_api_key=None,
            replicate_api_key=None,
            integrations=settings,
            byok_connection=connection,
            byok_wire_model=selection.wire_model,
        )

        assert isinstance(session, CopilotProviderSession)
        assert session._allow_reasoning_effort is False  # pyright: ignore[reportPrivateUsage]

    def test_an_arbitrary_deployment_never_maps_to_a_catalog_model(self) -> None:
        settings = settings_for()
        connection = settings.usable_byok
        assert connection is not None
        selection = connection.custom_selection

        assert selection is not None
        assert selection.base_model is neutral_base_model("openai")
        assert selection.base_model is not OPENAI_BASE


class TestEndpointNeutrality:
    """Nothing about the implementation is tied to one vendor or host."""

    @pytest.mark.parametrize(
        "base_url",
        [
            "https://models.example.org/v1",
            "https://api.example.com/openai/v1",
            "https://gateway.example.net:8443/v1",
            "https://example.org/inference",
            "http://localhost:8000/v1",
            "http://127.0.0.1:11434/v1",
        ],
    )
    def test_any_standards_compatible_base_url_is_accepted(
        self, base_url: str
    ) -> None:
        connection = connection_of(baseUrl=base_url)

        assert connection.base_url == base_url
        assert connection.is_usable

    @pytest.mark.parametrize(
        "base_url",
        ["http://models.example.org/v1", "ftp://example.org/v1", "https://"],
    )
    def test_unsafe_base_urls_are_refused(self, base_url: str) -> None:
        with pytest.raises(IntegrationConfigError):
            settings_for(baseUrl=base_url)

    def test_a_base_url_with_credentials_is_refused(self) -> None:
        with pytest.raises(IntegrationConfigError):
            settings_for(baseUrl="https://user:pass@models.example.org/v1")

    @pytest.mark.parametrize(
        "wire_model",
        [
            "custom-vision-model",
            "vendor/model-name",
            "model:tag-1",
            "team.model@2026-01-01",
            "a",
            "m" * 128,
        ],
    )
    def test_any_reasonable_model_id_is_accepted(self, wire_model: str) -> None:
        connection = connection_of(wireModel=wire_model)

        assert connection.wire_model == wire_model
        selection = connection.custom_selection
        assert selection is not None
        assert selection.wire_model == wire_model

    def test_a_bearer_token_works_as_the_dedicated_credential(self) -> None:
        connection = connection_of(apiKey=None, bearerToken="endpoint-bearer")

        assert connection.is_usable
        config = cast(
            dict[str, Any],
            build_provider_config(
                connection, neutral_base_model("openai"), wire_model=CUSTOM_MODEL
            ),
        )
        assert config["bearer_token"] == "endpoint-bearer"
        assert "api_key" not in config

    def test_a_loopback_endpoint_may_run_without_a_credential(self) -> None:
        connection = connection_of(
            baseUrl="http://localhost:8000/v1", apiKey=None, bearerToken=None
        )

        assert connection.is_usable

    def test_a_remote_endpoint_without_a_credential_is_not_usable(self) -> None:
        connection = connection_of(apiKey=None, bearerToken=None)

        assert connection.is_usable is False
        assert "API key" in (connection.unusable_reason or "")


class TestWireApiMode:
    def test_a_custom_endpoint_defaults_to_chat_completions(self) -> None:
        """Completions is the interface every compatible endpoint implements."""
        assert connection_of().wire_api == "completions"

    def test_a_vendor_connection_keeps_the_responses_default(self) -> None:
        connection = connection_of(baseUrl=None, wireModel=None)

        assert connection.wire_api == "responses"

    @pytest.mark.parametrize("wire_api", ["responses", "completions"])
    def test_an_explicit_mode_always_wins(self, wire_api: str) -> None:
        connection = connection_of(wireApi=wire_api)

        assert connection.wire_api == wire_api
        config = cast(
            dict[str, Any],
            build_provider_config(
                connection, neutral_base_model("openai"), wire_model=CUSTOM_MODEL
            ),
        )
        assert config["wire_api"] == wire_api

    def test_an_unknown_mode_is_refused(self) -> None:
        with pytest.raises(IntegrationConfigError) as excinfo:
            settings_for(wireApi="grpc")

        assert "responses or completions" in str(excinfo.value)


class TestOtherByokModesStillWork:
    def test_azure_keeps_its_deployment_and_api_version(self) -> None:
        settings = parse_integration_settings(
            {
                "copilotSdkByok": {
                    "enabled": True,
                    "provider": "azure",
                    "baseUrl": "https://resource.example.com",
                    "apiKey": "azure-secret",
                    "wireModel": "my-deployment",
                    "azureApiVersion": "2026-04-01-preview",
                }
            }
        )
        connection = settings.usable_byok
        assert connection is not None

        config = cast(
            dict[str, Any],
            build_provider_config(
                connection, neutral_base_model("azure"), wire_model="my-deployment"
            ),
        )
        assert config["type"] == "azure"
        assert config["wire_model"] == "my-deployment"
        assert config["azure"] == {"api_version": "2026-04-01-preview"}

    def test_anthropic_byok_still_offers_its_family(self) -> None:
        settings = parse_integration_settings(
            {
                "copilotSdkByok": {
                    "enabled": True,
                    "provider": "anthropic",
                    "apiKey": "anthropic-secret",
                }
            }
        )

        catalog = build_catalog(ProviderCredentials(byok=settings.byok_summary))
        models = next(p for p in catalog.providers if p.id == "sdk-byok").models
        assert len(models) > 1
        assert all("/custom/" not in model.id for model in models)

    def test_anthropic_byok_accepts_a_manual_wire_model(self) -> None:
        settings = parse_integration_settings(
            {
                "copilotSdkByok": {
                    "enabled": True,
                    "provider": "anthropic",
                    "apiKey": "anthropic-secret",
                    "wireModel": "custom-vision-model",
                }
            }
        )

        catalog = build_catalog(ProviderCredentials(byok=settings.byok_summary))
        models = next(p for p in catalog.providers if p.id == "sdk-byok").models
        assert [m.id for m in models] == [
            "sdk-byok/anthropic/custom/custom-vision-model"
        ]
        assert models[0].wire_model == "custom-vision-model"
