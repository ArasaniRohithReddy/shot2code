"""When every variant fails, say what the provider actually said.

"Error generating code. Please contact support." is the one answer a user can
do nothing with. These tests pin the replacement: per-variant errors are
retained, the real provider complaint is reported, and a client that
disconnects before sending its request is not treated as a failure at all.
"""

from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.websockets import WebSocketDisconnect

import routes.generate_code as generate_code
from copilot_auth import CopilotAuthSnapshot
from llm import Llm
from model_catalog import ModelRunSpec
from routes.generate_code import (
    AgenticGenerationStage,
    CodeGenerationMiddleware,
    ExtractedParams,
    ParameterExtractionMiddleware,
    PipelineContext,
    StatusBroadcastMiddleware,
)

GENERIC = "Error generating code. Please contact support."


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

    def of_type(self, msg_type: str) -> list[tuple[str, str | None, int, Any]]:
        return [message for message in self.messages if message[0] == msg_type]


def stage_for(recorder: Recorder) -> AgenticGenerationStage:
    return AgenticGenerationStage(
        send_message=recorder.send_message,
        openai_api_key="key",
        openai_base_url=None,
        anthropic_api_key=None,
        gemini_api_key=None,
        replicate_api_key=None,
        should_generate_images=False,
        file_state=None,
        asset_base_url="",
        option_codes=[],
    )


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
    if "selected_models" in params:
        params["selected_specs"] = [
            ModelRunSpec.native(model) for model in params.pop("selected_models")
        ]
    context.extracted_params = ExtractedParams(**params)
    return context


class TestVariantErrorsAreRetained:
    def test_a_recorded_error_is_kept(self) -> None:
        stage = stage_for(Recorder())

        stage._record_variant_error(0, "OpenAI has no credits.", "billing")  # pyright: ignore[reportPrivateUsage]

        assert stage.variant_errors[0] == "OpenAI has no credits."
        assert stage.variant_error_categories[0] == "billing"

    def test_a_later_generic_handler_does_not_overwrite_a_precise_one(self) -> None:
        stage = stage_for(Recorder())

        stage._record_variant_error(0, "OpenAI has no credits.", "billing")  # pyright: ignore[reportPrivateUsage]
        stage._record_variant_error(0, "Something went wrong.", "unknown")  # pyright: ignore[reportPrivateUsage]

        assert stage.variant_errors[0] == "OpenAI has no credits."
        assert stage.variant_error_categories[0] == "billing"

    def test_each_variant_keeps_its_own_error(self) -> None:
        stage = stage_for(Recorder())

        stage._record_variant_error(0, "billing problem", "billing")  # pyright: ignore[reportPrivateUsage]
        stage._record_variant_error(1, "bad key", "credentials")  # pyright: ignore[reportPrivateUsage]

        assert stage.variant_errors == {0: "billing problem", 1: "bad key"}

    @pytest.mark.asyncio
    async def test_a_failing_variant_records_and_reports_the_same_message(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        recorder = Recorder()
        stage = stage_for(recorder)

        class ExplodingAgent:
            def __init__(self, **_kwargs: Any) -> None:
                return None

            async def run(self, *_args: Any, **_kwargs: Any) -> str:
                raise Exception("You have no credits remaining. Please add credits.")

        monkeypatch.setattr(generate_code, "Agent", ExplodingAgent)

        completions = await stage.process_variants(
            [ModelRunSpec.native(Llm.GPT_5_5_HIGH)], []
        )

        assert completions == {}
        assert stage.variant_error_categories[0] == "billing"
        variant_errors = recorder.of_type("variantError")
        assert variant_errors and variant_errors[0][1] == stage.variant_errors[0]
        assert "add credits" in stage.variant_errors[0].lower()


class TestFailureSummary:
    def test_no_failures_means_no_summary(self) -> None:
        assert stage_for(Recorder()).failure_summary() is None

    def test_a_single_failure_is_reported_verbatim(self) -> None:
        stage = stage_for(Recorder())
        stage._record_variant_error(0, "OpenAI has no credits.", "billing")  # pyright: ignore[reportPrivateUsage]

        assert stage.failure_summary() == "OpenAI has no credits."

    def test_identical_failures_collapse_to_one_message(self) -> None:
        stage = stage_for(Recorder())
        for index in range(4):
            stage._record_variant_error(index, "OpenAI has no credits.", "billing")  # pyright: ignore[reportPrivateUsage]

        assert stage.failure_summary() == "OpenAI has no credits."

    def test_different_failures_are_labelled_per_option(self) -> None:
        stage = stage_for(Recorder())
        stage._record_variant_error(0, "OpenAI has no credits.", "billing")  # pyright: ignore[reportPrivateUsage]
        stage._record_variant_error(1, "Anthropic rejected the key.", "credentials")  # pyright: ignore[reportPrivateUsage]

        summary = stage.failure_summary(labels=["Option 1 (gpt)", "Option 2 (claude)"])

        assert summary is not None
        assert "Option 1 (gpt): OpenAI has no credits." in summary
        assert "Option 2 (claude): Anthropic rejected the key." in summary

    def test_labels_fall_back_to_option_numbers(self) -> None:
        stage = stage_for(Recorder())
        stage._record_variant_error(0, "first", "billing")  # pyright: ignore[reportPrivateUsage]
        stage._record_variant_error(1, "second", "credentials")  # pyright: ignore[reportPrivateUsage]

        summary = stage.failure_summary()

        assert summary is not None
        assert "Option 1: first" in summary
        assert "Option 2: second" in summary


class TestAllVariantsFailed:
    @pytest.fixture(autouse=True)
    def stub_snapshot(self, monkeypatch: pytest.MonkeyPatch):
        async def fake_snapshot(
            github_token: str | None = None, force: bool = False
        ) -> CopilotAuthSnapshot:
            return CopilotAuthSnapshot(available=False, login=None, models=[])

        monkeypatch.setattr(generate_code, "get_copilot_snapshot", fake_snapshot)

    async def run_with_failure(
        self,
        monkeypatch: pytest.MonkeyPatch,
        errors: dict[int, str],
    ) -> Recorder:
        recorder = Recorder()

        async def fake_process_variants(
            self: AgenticGenerationStage,
            variant_specs: list[ModelRunSpec],
            prompt_messages: list[Any],
        ) -> dict[int, str]:
            for index, message in errors.items():
                self._record_variant_error(index, message, "billing")  # pyright: ignore[reportPrivateUsage]
            return {}

        monkeypatch.setattr(
            generate_code.AgenticGenerationStage,
            "process_variants",
            fake_process_variants,
        )

        context = context_for(
            recorder, selected_models=[Llm.GPT_5_5_HIGH, Llm.GPT_5_6_SOL_LOW]
        )
        await StatusBroadcastMiddleware().process(context, AsyncMock())
        await CodeGenerationMiddleware().process(context, AsyncMock())
        return recorder

    @pytest.mark.asyncio
    async def test_the_provider_error_replaces_the_generic_apology(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        message = (
            "OpenAI reports no available credit for this account. Add credits "
            "or update the billing details on the provider's dashboard."
        )

        recorder = await self.run_with_failure(
            monkeypatch, {0: message, 1: message}
        )

        assert recorder.errors == [message]
        assert GENERIC not in recorder.errors

    @pytest.mark.asyncio
    async def test_distinct_failures_are_aggregated_with_option_labels(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        recorder = await self.run_with_failure(
            monkeypatch, {0: "no credits", 1: "bad key"}
        )

        assert len(recorder.errors) == 1
        summary = recorder.errors[0]
        assert "no credits" in summary
        assert "bad key" in summary
        assert Llm.GPT_5_5_HIGH.value in summary

    @pytest.mark.asyncio
    async def test_a_failure_with_no_recorded_error_still_avoids_the_apology(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        recorder = await self.run_with_failure(monkeypatch, {})

        assert recorder.errors
        assert GENERIC not in recorder.errors
        assert "provider settings" in recorder.errors[0]


class TestDisconnectBeforeParams:
    @pytest.mark.asyncio
    async def test_a_client_that_leaves_first_is_not_an_error(self) -> None:
        """No ASGI traceback for a navigation or a refresh."""
        context = PipelineContext(websocket=MagicMock())

        async def receive_params() -> dict[str, Any]:
            raise WebSocketDisconnect(code=1001)

        context.ws_comm = cast(
            Any,
            SimpleNamespace(
                receive_params=receive_params,
                send_message=AsyncMock(),
                throw_error=AsyncMock(),
            ),
        )
        next_func = AsyncMock()

        await ParameterExtractionMiddleware().process(context, next_func)

        next_func.assert_not_awaited()
        assert context.extracted_params is None

    @pytest.mark.asyncio
    async def test_a_normal_request_still_continues_the_pipeline(self) -> None:
        context = PipelineContext(websocket=MagicMock())

        async def receive_params() -> dict[str, Any]:
            return {
                "generatedCodeConfig": "html_tailwind",
                "inputMode": "text",
                "prompt": {"text": "hello"},
            }

        context.ws_comm = cast(
            Any,
            SimpleNamespace(
                receive_params=receive_params,
                send_message=AsyncMock(),
                throw_error=AsyncMock(),
            ),
        )
        next_func = AsyncMock()

        await ParameterExtractionMiddleware().process(context, next_func)

        next_func.assert_awaited_once()
        assert context.extracted_params is not None
