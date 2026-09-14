from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from typing import Any, cast

import pytest

from llm import Llm
from routes.generate_code import (
    ExtractedParams,
    PipelineContext,
    StatusBroadcastMiddleware,
)


@pytest.mark.asyncio
async def test_video_update_broadcasts_two_variants() -> None:
    sent_messages: list[tuple[str, str | None, int]] = []

    async def send_message(
        msg_type: str,
        value: str | None,
        variant_index: int,
        data=None,
        eventId=None,
    ) -> None:
        sent_messages.append((msg_type, value, variant_index))

    context = PipelineContext(websocket=MagicMock())
    context.ws_comm = cast(
        Any,
        SimpleNamespace(
            send_message=send_message,
            throw_error=AsyncMock(),
        ),
    )
    context.extracted_params = ExtractedParams(
        stack="html_tailwind",
        input_mode="video",
        should_generate_images=True,
        openai_api_key=None,
        anthropic_api_key=None,
        gemini_api_key="key",
        replicate_api_key=None,
        openai_base_url=None,
        generation_type="update",
        prompt={"text": "Edit this video output", "images": [], "videos": []},
        history=[],
        file_state=None,
        option_codes=[],
    )

    middleware = StatusBroadcastMiddleware()
    next_called = False

    async def next_func() -> None:
        nonlocal next_called
        next_called = True

    await middleware.process(context, next_func)

    assert sent_messages[0] == ("variantCount", "2", 0)
    status_messages = [m for m in sent_messages if m[0] == "status"]
    assert len(status_messages) == 2
    assert [m[2] for m in status_messages] == [0, 1]
    assert next_called is True


@pytest.mark.asyncio
async def test_image_update_broadcasts_two_variants() -> None:
    sent_messages: list[tuple[str, str | None, int]] = []

    async def send_message(
        msg_type: str,
        value: str | None,
        variant_index: int,
        data=None,
        eventId=None,
    ) -> None:
        sent_messages.append((msg_type, value, variant_index))

    context = PipelineContext(websocket=MagicMock())
    context.ws_comm = cast(
        Any,
        SimpleNamespace(
            send_message=send_message,
            throw_error=AsyncMock(),
        ),
    )
    context.extracted_params = ExtractedParams(
        stack="html_tailwind",
        input_mode="image",
        should_generate_images=True,
        openai_api_key="key",
        anthropic_api_key="key",
        gemini_api_key=None,
        replicate_api_key=None,
        openai_base_url=None,
        generation_type="update",
        prompt={"text": "Edit this screenshot", "images": ["data:image/png;base64,abc"], "videos": []},
        history=[],
        file_state={"path": "index.html", "content": "<html></html>"},
        option_codes=[],
    )

    middleware = StatusBroadcastMiddleware()
    next_called = False

    async def next_func() -> None:
        nonlocal next_called
        next_called = True

    await middleware.process(context, next_func)

    assert sent_messages[0] == ("variantCount", "2", 0)
    status_messages = [m for m in sent_messages if m[0] == "status"]
    assert len(status_messages) == 2
    assert [m[2] for m in status_messages] == [0, 1]
    assert next_called is True


@pytest.mark.asyncio
async def test_retry_broadcasts_the_original_variant_count() -> None:
    sent_messages: list[tuple[str, str | None, int]] = []

    async def send_message(
        msg_type: str,
        value: str | None,
        variant_index: int,
        data=None,
        eventId=None,
    ) -> None:
        sent_messages.append((msg_type, value, variant_index))

    context = PipelineContext(websocket=MagicMock())
    context.ws_comm = cast(
        Any,
        SimpleNamespace(send_message=send_message, throw_error=AsyncMock()),
    )
    context.extracted_params = ExtractedParams(
        stack="react_tailwind",
        input_mode="image",
        should_generate_images=True,
        openai_api_key="key",
        anthropic_api_key="key",
        gemini_api_key="key",
        replicate_api_key=None,
        openai_base_url=None,
        generation_type="update",
        prompt={"text": "Retry", "images": [], "videos": []},
        history=[],
        file_state={"path": "src/App.tsx", "content": "export default App"},
        option_codes=[],
        retry_models=[
            Llm.GPT_5_6_SOL_HIGH,
            Llm.CLAUDE_OPUS_5_HIGH,
            Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL,
        ],
    )

    await StatusBroadcastMiddleware().process(context, AsyncMock())

    assert sent_messages[0] == ("variantCount", "3", 0)
    assert [message[2] for message in sent_messages[1:]] == [0, 1, 2]


def _context_with(**overrides: Any) -> PipelineContext:
    sent: list[tuple[str, str | None, int]] = []

    async def send_message(
        msg_type: str,
        value: str | None,
        variant_index: int,
        data: Any = None,
        eventId: Any = None,
    ) -> None:
        sent.append((msg_type, value, variant_index))

    context = PipelineContext(websocket=MagicMock())
    context.ws_comm = cast(
        Any,
        SimpleNamespace(send_message=send_message, throw_error=AsyncMock()),
    )
    params: dict[str, Any] = {
        "stack": "html_tailwind",
        "input_mode": "image",
        "should_generate_images": True,
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
    context.metadata["sent"] = sent
    return context


@pytest.mark.asyncio
async def test_one_variant_is_announced_per_selected_model() -> None:
    context = _context_with(
        selected_models=[Llm.GPT_5_5_HIGH, Llm.GPT_5_6_SOL_LOW],
    )

    await StatusBroadcastMiddleware().process(context, AsyncMock())

    sent = context.metadata["sent"]
    assert sent[0] == ("variantCount", "2", 0)
    assert [message[2] for message in sent[1:]] == [0, 1]
    assert context.planned_variant_count == 2


@pytest.mark.asyncio
async def test_a_single_selected_model_announces_a_single_variant() -> None:
    context = _context_with(selected_models=[Llm.GPT_5_5_HIGH])

    await StatusBroadcastMiddleware().process(context, AsyncMock())

    assert context.metadata["sent"][0] == ("variantCount", "1", 0)


@pytest.mark.asyncio
async def test_selection_beyond_the_limit_is_capped() -> None:
    context = _context_with(
        selected_models=[
            Llm.GPT_5_5_LOW,
            Llm.GPT_5_5_MEDIUM,
            Llm.GPT_5_5_HIGH,
            Llm.GPT_5_5_XHIGH,
            Llm.GPT_5_6_SOL_LOW,
        ],
    )

    await StatusBroadcastMiddleware().process(context, AsyncMock())

    assert context.metadata["sent"][0] == ("variantCount", "4", 0)


@pytest.mark.asyncio
async def test_update_selection_is_capped_at_two() -> None:
    context = _context_with(
        generation_type="update",
        selected_models=[Llm.GPT_5_5_LOW, Llm.GPT_5_5_MEDIUM, Llm.GPT_5_5_HIGH],
    )

    await StatusBroadcastMiddleware().process(context, AsyncMock())

    assert context.metadata["sent"][0] == ("variantCount", "2", 0)


@pytest.mark.asyncio
async def test_no_selection_announces_the_full_limit() -> None:
    context = _context_with()

    await StatusBroadcastMiddleware().process(context, AsyncMock())

    assert context.metadata["sent"][0] == ("variantCount", "4", 0)
