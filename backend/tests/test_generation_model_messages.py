"""The websocket contract for model selection: counts, ids and notices."""

from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest

import routes.generate_code as generate_code
from copilot_auth import CopilotAuthSnapshot
from llm import Llm
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
        self: Any, variant_models: list[Llm], prompt_messages: list[Any]
    ) -> dict[int, str]:
        return {index: f"<html>{model.value}</html>" for index, model in enumerate(variant_models)}

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
