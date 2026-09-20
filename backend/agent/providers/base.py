from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal, Optional, Protocol

from agent.tools import ToolCall, ToolExecutionResult


StreamEventType = Literal[
    "assistant_delta",
    "thinking_delta",
    "tool_call_delta",
    # Tools the provider's own agent runtime executed (MCP servers reached
    # through the Copilot SDK). shot2code never runs these itself, so they
    # arrive already started, progressed and finished.
    "external_tool_start",
    "external_tool_progress",
    "external_tool_result",
]


@dataclass
class StreamEvent:
    type: StreamEventType
    text: str = ""
    tool_call_id: Optional[str] = None
    tool_name: Optional[str] = None
    tool_arguments: Any = None
    # How an externally executed tool should be named in the activity feed.
    tool_display_name: Optional[str] = None
    # Whether an externally executed tool succeeded; None until it finishes.
    tool_ok: Optional[bool] = None


@dataclass
class ProviderTurn:
    assistant_text: str
    tool_calls: list[ToolCall]
    # Provider-native assistant turn object required to continue the conversation.
    assistant_turn: Any = None


@dataclass
class ExecutedToolCall:
    tool_call: ToolCall
    result: ToolExecutionResult


EventSink = Callable[[StreamEvent], Awaitable[None]]


class ProviderSession(Protocol):
    async def stream_turn(self, on_event: EventSink) -> ProviderTurn:
        ...

    async def append_tool_results(
        self,
        turn: ProviderTurn,
        executed_tool_calls: list[ExecutedToolCall],
    ) -> None:
        ...

    def total_cost_usd(self) -> Optional[float]:
        """USD spent so far this session; None when the model is unpriced."""
        ...

    async def close(self) -> None:
        ...
