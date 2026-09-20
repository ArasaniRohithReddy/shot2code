"""The websocket contract for model selection: counts, ids and notices."""

from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest

import routes.generate_code as generate_code
from copilot_auth import CopilotAuthSnapshot
from integrations.config import parse_integration_settings
from llm import Llm
from integrations.config import parse_integration_settings
from model_catalog import ModelRunSpec, parse_model_selections
from routes.generate_code import (
    CodeGenerationMiddleware,
    ExtractedParams,
    PipelineContext,
    StatusBroadcastMiddleware,
)


class Recorder:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str | None, int, dict[str, Any] | None]] = []
        self.errors: list[str] = []

    async def send_message(
        self,
        msg_type: str,
        value: str | None,
        variant_index: int,
        data: dict[str, Any] | None = None,
        eventId: str | None = None,
    ) -> None:
        self.messages.append((msg_type, value, variant_index, data))

    async def throw_error(self, message: str) -> None:
        self.errors.append(message)

    def of_type(self, msg_type: str) -> list[tuple[str, str | None, int, dict[str, Any] | None]]:
        return [message for message in self.messages if message[0] == msg_type]


def context_for(recorder: Recorder, **overrides: Any) -> PipelineContext:
    context = PipelineContext(websocket=MagicMock())
    context.ws_comm = cast(
        Any,
        SimpleNamespace(
            send_message=recorder.send_message,
            throw_error=recorder.throw_error,
        ),
    )
    params: dict[str, Any] = {
        "stack": "html_tailwind",
        "input_mode": "image",
        "should_generate_images": False,
        "openai_api_key": "key",
        "anthropic_api_key": None,
        "gemini_api_key": None,
        "replicate_api_key": None,
        "openai_base_url": None,
        "generation_type": "create",
        "prompt": {"text": "Build", "images": [], "videos": []},
        "history": [],
        "file_state": None,
        "option_codes": [],
    }
    params.update(overrides)
    # Tests express picks as direct models; the pipeline works on targets.
    for key in ("selected_models", "retry_models"):
        if key in params:
            models = params.pop(key)
            target_key = (
                "selected_specs" if key == "selected_models" else "retry_specs"
            )
            params[target_key] = [ModelRunSpec.native(model) for model in models]
    context.extracted_params = ExtractedParams(**params)
    return context


@pytest.fixture(autouse=True)
def stub_generation(monkeypatch: pytest.MonkeyPatch):
    """Run the selection path without starting a single model call."""

    async def fake_snapshot(
        github_token: str | None = None, force: bool = False
    ) -> CopilotAuthSnapshot:
        return CopilotAuthSnapshot(available=False, login=None, models=[])

    monkeypatch.setattr(generate_code, "get_copilot_snapshot", fake_snapshot)

    async def fake_process_variants(
        self: Any, variant_specs: list[ModelRunSpec], prompt_messages: list[Any]
    ) -> dict[int, str]:
        return {
            index: f"<html>{spec.selection_id}</html>"
            for index, spec in enumerate(variant_specs)
        }

    monkeypatch.setattr(
        generate_code.AgenticGenerationStage,
        "process_variants",
        fake_process_variants,
    )


async def run_pipeline(context: PipelineContext) -> None:
    await StatusBroadcastMiddleware().process(context, AsyncMock())
    await CodeGenerationMiddleware().process(context, AsyncMock())


@pytest.mark.asyncio
async def test_one_variant_per_selected_model_end_to_end() -> None:
    recorder = Recorder()
    context = context_for(
        recorder,
        selected_models=[Llm.GPT_5_5_HIGH, Llm.GPT_5_6_SOL_LOW],
    )

    await run_pipeline(context)

    assert [message[1] for message in recorder.of_type("variantCount")] == ["2"]
    models_message = recorder.of_type("variantModels")[0][3]
    assert models_message == {
        "models": [Llm.GPT_5_5_HIGH.value, Llm.GPT_5_6_SOL_LOW.value]
    }
    assert len(context.completions) == 2


@pytest.mark.asyncio
async def test_stale_picks_shrink_the_run_and_say_why() -> None:
    recorder = Recorder()
    context = context_for(
        recorder,
        selected_models=[Llm.GPT_5_5_HIGH, Llm.CLAUDE_OPUS_5_HIGH],
        unknown_selected_models=["ghost-model"],
    )

    await run_pipeline(context)

    # Unknown ids can never run, so they are not counted in the announcement;
    # the credential-less pick is only discovered later, and shrinks the run.
    assert [message[1] for message in recorder.of_type("variantCount")] == ["2", "1"]
    data = recorder.of_type("variantModels")[0][3]
    assert data is not None
    assert data["models"] == [Llm.GPT_5_5_HIGH.value]
    assert set(data["droppedModels"]) == {
        Llm.CLAUDE_OPUS_5_HIGH.value,
        "ghost-model",
    }
    assert "Anthropic API key" in data["notice"]
    assert "unknown model" in data["notice"]


@pytest.mark.asyncio
async def test_automatic_selection_reports_no_notice() -> None:
    recorder = Recorder()
    context = context_for(recorder)

    await run_pipeline(context)

    assert [message[1] for message in recorder.of_type("variantCount")] == ["4"]
    data = recorder.of_type("variantModels")[0][3]
    assert data is not None
    assert len(data["models"]) == 4
    assert "notice" not in data


@pytest.mark.asyncio
async def test_every_pick_unusable_falls_back_and_warns() -> None:
    recorder = Recorder()
    context = context_for(
        recorder,
        selected_models=[Llm.CLAUDE_OPUS_5_HIGH],
    )

    await run_pipeline(context)

    data = recorder.of_type("variantModels")[0][3]
    assert data is not None
    assert data["models"] == [
        Llm.GPT_5_5_HIGH.value,
        Llm.GPT_5_5_LOW.value,
        Llm.GPT_5_5_HIGH.value,
        Llm.GPT_5_5_LOW.value,
    ]
    assert "Fell back to automatic model selection." in data["notice"]
    assert [message[1] for message in recorder.of_type("variantCount")] == ["1", "4"]


@pytest.mark.asyncio
async def test_retry_replays_the_original_models() -> None:
    recorder = Recorder()
    retry_models = [Llm.GPT_5_5_HIGH, Llm.CLAUDE_OPUS_5_HIGH, Llm.GEMINI_3_6_FLASH_LOW]
    context = context_for(recorder, retry_models=retry_models)

    await run_pipeline(context)

    data = recorder.of_type("variantModels")[0][3]
    assert data is not None
    # Replayed verbatim: a retry is not re-filtered against today's credentials.
    assert data["models"] == [model.value for model in retry_models]
    assert [message[1] for message in recorder.of_type("variantCount")] == ["3"]


@pytest.mark.asyncio
async def test_no_usable_credentials_errors_instead_of_generating() -> None:
    recorder = Recorder()
    context = context_for(recorder, openai_api_key=None)

    await run_pipeline(context)

    assert recorder.errors
    assert "No API key found" in recorder.errors[0]
    assert recorder.of_type("variantModels") == []



@pytest.mark.asyncio
async def test_native_and_byok_runs_of_one_model_coexist() -> None:
    """The whole point of per-selection identity: both variants run."""
    recorder = Recorder()
    settings = parse_integration_settings(
        {
            "copilotSdkByok": {
                "enabled": True,
                "provider": "azure",
                "baseUrl": "https://res.openai.azure.com",
                "apiKey": "azure-secret",
            }
        }
    )
    specs, unknown = parse_model_selections(
        [
            {
                "id": Llm.GPT_5_5_HIGH.value,
                "baseModel": Llm.GPT_5_5_HIGH.value,
                "runtime": "native",
            },
            {
                "id": f"sdk-byok/azure/{Llm.GPT_5_5_HIGH.value}",
                "baseModel": Llm.GPT_5_5_HIGH.value,
                "runtime": "copilot-byok",
            },
        ]
    )
    assert unknown == ()
    context = context_for(recorder, integrations=settings, selected_specs=list(specs))

    await run_pipeline(context)

    data = recorder.of_type("variantModels")[0][3]
    assert data is not None
    # Two variants, same base model, two different run identities.
    assert data["models"] == [
        Llm.GPT_5_5_HIGH.value,
        f"sdk-byok/azure/{Llm.GPT_5_5_HIGH.value}",
    ]
    assert [message[1] for message in recorder.of_type("variantCount")] == ["2"]
    assert [spec.runtime for spec in context.variant_specs] == [
        "native",
        "copilot-byok",
    ]


@pytest.mark.asyncio
async def test_a_native_pick_is_never_rerouted_by_an_enabled_byok() -> None:
    recorder = Recorder()
    settings = parse_integration_settings(
        {
            "copilotSdkByok": {
                "enabled": True,
                "provider": "openai",
                "baseUrl": "https://api.example.com/v1",
                "apiKey": "sk-byok",
            }
        }
    )
    specs, _ = parse_model_selections([Llm.GPT_5_5_HIGH.value])
    context = context_for(recorder, integrations=settings, selected_specs=list(specs))

    await run_pipeline(context)

    data = recorder.of_type("variantModels")[0][3]
    assert data is not None
    assert data["models"] == [Llm.GPT_5_5_HIGH.value]
    assert context.variant_specs[0].runtime == "native"


@pytest.mark.asyncio
async def test_a_retry_replays_byok_identity() -> None:
    recorder = Recorder()
    settings = parse_integration_settings(
        {
            "copilotSdkByok": {
                "enabled": True,
                "provider": "azure",
                "baseUrl": "https://res.openai.azure.com",
                "apiKey": "azure-rotated",
            }
        }
    )
    identity = f"sdk-byok/azure/{Llm.GPT_5_5_HIGH.value}"
    specs, _ = parse_model_selections([identity])
    context = context_for(recorder, integrations=settings, retry_specs=list(specs))

    await run_pipeline(context)

    data = recorder.of_type("variantModels")[0][3]
    assert data is not None
    assert data["models"] == [identity]
