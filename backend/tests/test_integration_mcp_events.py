"""SDK-internal MCP tool runs must appear in shot2code's own activity feed.

The Copilot SDK executes MCP tools inside its own loop, so shot2code never sees
a tool call for them. These tests pin the bridge: raw SDK events in, typed
StreamEvents out, and the same toolStart/toolResult messages the frontend
already renders - with secrets masked and output bounded.
"""

from typing import Any

import pytest

from agent.engine import AgentEngine
from agent.providers.base import StreamEvent
from agent.providers.github_copilot import CopilotProviderSession
from copilot.session_events import (
    ToolExecutionCompleteData,
    ToolExecutionProgressData,
    ToolExecutionStartData,
)
from llm import Llm


class FakeEvent:
    def __init__(self, event_type: str, data: Any) -> None:
        self.type = event_type
        self.data = data


def make_session() -> CopilotProviderSession:
    return CopilotProviderSession(
        client=object(),  # pyright: ignore[reportArgumentType]
        model=Llm.COPILOT_GPT_5_6_SOL,
        prompt_messages=[{"role": "user", "content": "hi"}],
        tools=[],
    )


def drain(session: CopilotProviderSession) -> list[StreamEvent]:
    events: list[StreamEvent] = []
    queue = session._queue  # pyright: ignore[reportPrivateUsage]
    while not queue.empty():
        _, payload = queue.get_nowait()
        events.append(payload)
    return events


def start_event(**fields: Any) -> FakeEvent:
    payload: dict[str, Any] = {
        "toolCallId": "call-1",
        "toolName": "docs-search",
        "mcpServerName": "docs",
        "mcpToolName": "search",
        "arguments": {"query": "pricing", "api_key": "sk-secret"},
    }
    payload.update(fields)
    return FakeEvent("tool.execution_start", ToolExecutionStartData.from_dict(payload))


def complete_event(**fields: Any) -> FakeEvent:
    payload: dict[str, Any] = {
        "toolCallId": "call-1",
        "success": True,
        "result": {"content": "Found 3 pages."},
    }
    payload.update(fields)
    return FakeEvent(
        "tool.execution_complete", ToolExecutionCompleteData.from_dict(payload)
    )


class TestProviderEventBridge:
    def test_an_mcp_tool_start_becomes_a_named_stream_event(self) -> None:
        session = make_session()

        session._on_session_event(start_event())  # pyright: ignore[reportPrivateUsage]

        (event,) = drain(session)
        assert event.type == "external_tool_start"
        assert event.tool_call_id == "call-1"
        assert event.tool_display_name == "MCP · docs · search"

    def test_arguments_are_redacted_before_they_leave_the_provider(self) -> None:
        session = make_session()

        session._on_session_event(start_event())  # pyright: ignore[reportPrivateUsage]

        (event,) = drain(session)
        assert event.tool_arguments["query"] == "pricing"
        assert event.tool_arguments["api_key"] == "[redacted]"
        assert "sk-secret" not in repr(event.tool_arguments)

    def test_shot2code_tools_are_not_duplicated_into_the_feed(self) -> None:
        """Our own tools already report through the handler path."""
        session = make_session()

        session._on_session_event(  # pyright: ignore[reportPrivateUsage]
            FakeEvent(
                "tool.execution_start",
                ToolExecutionStartData.from_dict(
                    {"toolCallId": "call-2", "toolName": "create_file"}
                ),
            )
        )

        assert drain(session) == []

    def test_progress_events_are_bounded_and_forwarded(self) -> None:
        session = make_session()
        session._on_session_event(start_event())  # pyright: ignore[reportPrivateUsage]
        session._on_session_event(  # pyright: ignore[reportPrivateUsage]
            FakeEvent(
                "tool.execution_progress",
                ToolExecutionProgressData.from_dict(
                    {"toolCallId": "call-1", "progressMessage": "x" * 5000}
                ),
            )
        )

        events = drain(session)
        progress = events[-1]
        assert progress.type == "external_tool_progress"
        assert len(progress.text) < 400

    def test_completion_reports_a_bounded_summary(self) -> None:
        session = make_session()
        session._on_session_event(start_event())  # pyright: ignore[reportPrivateUsage]
        session._on_session_event(  # pyright: ignore[reportPrivateUsage]
            complete_event(result={"content": "page " * 1000})
        )

        result = drain(session)[-1]
        assert result.type == "external_tool_result"
        assert result.tool_ok is True
        assert len(result.text) < 700

    def test_failures_report_the_error_message_and_not_ok(self) -> None:
        session = make_session()
        session._on_session_event(start_event())  # pyright: ignore[reportPrivateUsage]
        session._on_session_event(  # pyright: ignore[reportPrivateUsage]
            complete_event(
                success=False, result=None, error={"message": "server refused"}
            )
        )

        result = drain(session)[-1]
        assert result.tool_ok is False
        assert "server refused" in result.text

    def test_completion_without_a_matching_start_is_ignored(self) -> None:
        session = make_session()

        session._on_session_event(complete_event(toolCallId="unknown"))  # pyright: ignore[reportPrivateUsage]

        assert drain(session) == []


class RecordingEngine(AgentEngine):
    """An engine that captures what it would send over the websocket."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, Any, Any]] = []

        async def capture(
            msg_type: str,
            value: str | None,
            variant_index: int,
            data: dict[str, Any] | None,
            event_id: str | None,
        ) -> None:
            self.sent.append((msg_type, data, event_id))

        super().__init__(
            send_message=capture,
            variant_index=0,
            openai_api_key=None,
            openai_base_url=None,
            anthropic_api_key=None,
            gemini_api_key=None,
            replicate_api_key=None,
            should_generate_images=False,
        )


class TestEngineBridge:
    @pytest.mark.asyncio
    async def test_start_and_result_reach_the_websocket_channels(self) -> None:
        engine = RecordingEngine()
        started: set[str] = set()

        await engine._handle_external_tool_event(  # pyright: ignore[reportPrivateUsage]
            StreamEvent(
                type="external_tool_start",
                tool_call_id="call-1",
                tool_name="search",
                tool_display_name="MCP · docs · search",
                tool_arguments={"query": "pricing"},
            ),
            started,
        )
        await engine._handle_external_tool_event(  # pyright: ignore[reportPrivateUsage]
            StreamEvent(
                type="external_tool_result",
                text="Found 3 pages.",
                tool_call_id="call-1",
                tool_name="search",
                tool_display_name="MCP · docs · search",
                tool_ok=True,
            ),
            started,
        )

        types = [entry[0] for entry in engine.sent]
        assert types == ["toolStart", "toolResult"]

        start_payload = engine.sent[0][1]
        assert start_payload is not None
        assert start_payload["name"] == "MCP · docs · search"
        assert start_payload["input"] == {"query": "pricing"}
        assert engine.sent[0][2] == "call-1"

        result_payload = engine.sent[1][1]
        assert result_payload is not None
        assert result_payload["output"] == "Found 3 pages."
        assert result_payload["ok"] is True

    @pytest.mark.asyncio
    async def test_a_failed_mcp_call_is_marked_not_ok(self) -> None:
        engine = RecordingEngine()

        await engine._handle_external_tool_event(  # pyright: ignore[reportPrivateUsage]
            StreamEvent(
                type="external_tool_result",
                text="server refused",
                tool_call_id="call-9",
                tool_display_name="MCP · docs · write",
                tool_ok=False,
            ),
            set(),
        )

        payload = engine.sent[0][1]
        assert payload is not None
        assert payload["ok"] is False

    @pytest.mark.asyncio
    async def test_a_repeated_start_does_not_duplicate_the_feed(self) -> None:
        engine = RecordingEngine()
        started: set[str] = set()
        event = StreamEvent(
            type="external_tool_start",
            tool_call_id="call-1",
            tool_display_name="MCP · docs · search",
            tool_arguments={},
        )

        await engine._handle_external_tool_event(event, started)  # pyright: ignore[reportPrivateUsage]
        await engine._handle_external_tool_event(event, started)  # pyright: ignore[reportPrivateUsage]

        assert len(engine.sent) == 1

    @pytest.mark.asyncio
    async def test_progress_events_do_not_reach_the_websocket(self) -> None:
        engine = RecordingEngine()

        await engine._handle_external_tool_event(  # pyright: ignore[reportPrivateUsage]
            StreamEvent(
                type="external_tool_progress",
                text="working",
                tool_call_id="call-1",
                tool_display_name="MCP · docs · search",
            ),
            set(),
        )

        assert engine.sent == []
