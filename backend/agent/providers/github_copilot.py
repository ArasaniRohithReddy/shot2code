# pyright: reportUnknownVariableType=false
"""GitHub Copilot SDK provider.

The Copilot SDK is an *agent runtime*, not a chat-completions endpoint: it owns
its own planning loop and invokes tools through handler callbacks. shot2code's
engine also owns a loop (it streams code previews, emits toolStart/toolResult
events and records runs), so the two cannot both drive.

This module bridges them. Every canonical shot2code tool is registered with the
SDK using a handler that parks the Copilot agent on an ``asyncio.Future`` and
hands the call back to shot2code's engine. When the engine finishes executing
the tool it resolves that future via :meth:`append_tool_results`, which unblocks
the Copilot agent so it can continue. The result is that Copilot behaves like
every other provider from the engine's point of view.
"""

import asyncio
import base64
import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import copilot
from copilot.tools import ToolBinaryResult, ToolInvocation
from openai.types.chat import ChatCompletionMessageParam

from agent.providers.base import (
    EventSink,
    ExecutedToolCall,
    ProviderSession,
    ProviderTurn,
    StreamEvent,
)
from agent.tools import CanonicalToolDefinition, ToolCall
from costs.token_usage import TokenUsage
from fs_logging.agent_runs import AgentRunRecorder
from llm import Llm, get_copilot_api_name, get_copilot_reasoning_effort


# Queue item tags used to serialize everything the SDK emits into one ordered
# stream, so assistant text can never overtake a tool request.
_TAG_TEXT = "text"
_TAG_THINKING = "thinking"
_TAG_TOOL = "tool"
_TAG_DONE = "done"
_TAG_ERROR = "error"

# A full code generation can run for several minutes. send_and_wait defaults to
# 60s, which would abort mid-generation.
_SEND_TIMEOUT_SECONDS = 900.0


@dataclass
class _PendingToolCall:
    """A tool the Copilot agent asked for, parked until the engine answers."""

    tool_call: ToolCall
    future: "asyncio.Future[Any]"


def serialize_copilot_tools(
    tools: List[CanonicalToolDefinition],
) -> List[CanonicalToolDefinition]:
    """Copilot consumes canonical definitions directly.

    Handlers are attached later in the session because each one closes over
    that session's pending-call bookkeeping.
    """
    return list(tools)


def _extract_system_prompt(messages: List[ChatCompletionMessageParam]) -> str:
    for message in messages:
        if message.get("role") == "system":
            content = message.get("content", "")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                return "\n".join(
                    part.get("text", "")
                    for part in content
                    if isinstance(part, dict) and part.get("type") == "text"
                )
    return ""


def _split_data_url(url: str) -> Optional[Tuple[str, str]]:
    """Return ``(mime_type, base64_data)`` for a data: URL, else ``None``."""
    if not url.startswith("data:"):
        return None
    try:
        header, data = url.split(",", 1)
    except ValueError:
        return None
    mime_type = header[5:].split(";")[0] or "image/png"
    if ";base64" not in header:
        return None
    return mime_type, data


def _build_prompt_and_attachments(
    messages: List[ChatCompletionMessageParam],
) -> Tuple[str, List[Dict[str, Any]]]:
    """Flatten non-system messages into one prompt plus image attachments.

    The SDK takes a single prompt string per ``send``; images ride along as
    blob attachments rather than inline parts.
    """
    text_chunks: List[str] = []
    attachments: List[Dict[str, Any]] = []
    image_index = 0

    for message in messages:
        role = message.get("role", "user")
        if role == "system":
            continue

        content = message.get("content", "")
        if isinstance(content, str):
            if content:
                text_chunks.append(content)
            continue

        if not isinstance(content, list):
            continue

        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text":
                text = part.get("text", "")
                if text:
                    text_chunks.append(text)
            elif part.get("type") == "image_url":
                url = (part.get("image_url") or {}).get("url", "")
                if not url:
                    continue
                decoded = _split_data_url(url)
                image_index += 1
                if decoded is None:
                    # Remote URLs can't be attached as blobs; let the model
                    # see the link rather than dropping the image silently.
                    text_chunks.append(f"[image {image_index}: {url}]")
                    continue
                mime_type, data = decoded
                attachments.append(
                    {
                        "type": "blob",
                        "data": data,
                        "mimeType": mime_type,
                        "displayName": f"input-image-{image_index}",
                    }
                )

    return "\n\n".join(chunk for chunk in text_chunks if chunk), attachments


def _extract_event_text(event: Any) -> str:
    """Best-effort text from the final assistant message event."""
    if event is None:
        return ""
    data = getattr(event, "data", None)
    for attr in ("content", "text", "message"):
        value = getattr(data, attr, None)
        if isinstance(value, str) and value:
            return value
    return ""


def _to_tool_result(result: Any) -> "copilot.ToolResult":
    """Convert a shot2code ToolExecutionResult into an SDK ToolResult."""
    payload = getattr(result, "result", None)
    try:
        text = json.dumps(payload, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(payload)

    binary: List[ToolBinaryResult] = []
    for part in getattr(result, "multimodal_parts", None) or []:
        data_bytes: Optional[bytes] = getattr(part, "data", None)
        if data_bytes is not None:
            binary.append(
                ToolBinaryResult(
                    data=base64.b64encode(data_bytes).decode("ascii"),
                    mime_type=getattr(part, "mime_type", "image/png"),
                    type="image",
                    description=getattr(part, "display_name", "image"),
                )
            )

    return copilot.ToolResult(
        text_result_for_llm=text,
        result_type="success" if getattr(result, "ok", True) else "failure",
        binary_results_for_llm=binary or None,
    )


class CopilotProviderSession(ProviderSession):
    def __init__(
        self,
        client: "copilot.CopilotClient",
        model: Llm,
        prompt_messages: List[ChatCompletionMessageParam],
        tools: List[CanonicalToolDefinition],
        recorder: Optional[AgentRunRecorder] = None,
    ):
        self._client = client
        self._model = model
        self._tool_definitions = tools
        self._recorder = recorder
        self._total_usage = TokenUsage()
        self._reported_cost_usd: Optional[float] = None

        self._system_prompt = _extract_system_prompt(prompt_messages)
        self._prompt, self._attachments = _build_prompt_and_attachments(prompt_messages)

        self._session: Optional[Any] = None
        self._queue: "asyncio.Queue[Tuple[str, Any]]" = asyncio.Queue()
        self._send_task: Optional["asyncio.Task[None]"] = None
        self._pending: Dict[str, _PendingToolCall] = {}
        self._started = False
        self._client_owned = True

    def _make_handler(self, tool_name: str):
        # The SDK inspects this signature and passes a ToolInvocation when the
        # single parameter is annotated as one. An untyped parameter gets a
        # different shape, which is why the annotation matters here.
        async def handler(invocation: ToolInvocation) -> "copilot.ToolResult":
            raw_arguments = getattr(invocation, "arguments", None)
            if isinstance(raw_arguments, str):
                try:
                    raw_arguments = json.loads(raw_arguments)
                except (TypeError, ValueError):
                    raw_arguments = None
            arguments: Dict[str, Any] = (
                dict(raw_arguments) if isinstance(raw_arguments, dict) else {}
            )
            tool_call_id = (
                getattr(invocation, "tool_call_id", None)
                or f"copilot_{uuid.uuid4().hex[:12]}"
            )
            pending = _PendingToolCall(
                tool_call=ToolCall(
                    id=tool_call_id,
                    name=tool_name,
                    arguments=arguments,
                ),
                future=asyncio.get_running_loop().create_future(),
            )
            self._pending[pending.tool_call.id] = pending
            await self._queue.put((_TAG_TOOL, pending))
            # Parks this Copilot tool invocation until shot2code's engine has
            # actually run the tool and called append_tool_results.
            result = await pending.future
            return _to_tool_result(result)

        return handler

    def _on_session_event(self, event: Any) -> None:
        """Sync callback from the SDK; only enqueues, never awaits."""
        raw_type = getattr(event, "type", None)
        event_type = getattr(raw_type, "value", raw_type)
        data = getattr(event, "data", None)

        if event_type == "assistant.message_delta":
            text = getattr(data, "delta_content", None)
            if text:
                self._queue.put_nowait((_TAG_TEXT, text))
        elif event_type == "assistant.reasoning_delta":
            text = getattr(data, "delta_content", None) or getattr(data, "text", None)
            if text:
                self._queue.put_nowait((_TAG_THINKING, text))
        elif event_type == "assistant.usage":
            self._accumulate_usage(data)

    def _accumulate_usage(self, data: Any) -> None:
        if data is None:
            return
        usage = TokenUsage(
            input=getattr(data, "input_tokens", 0) or 0,
            output=getattr(data, "output_tokens", 0) or 0,
            cache_read=getattr(data, "cache_read_tokens", 0) or 0,
            cache_write=getattr(data, "cache_write_tokens", 0) or 0,
        )
        self._total_usage.accumulate(usage)
        cost = getattr(data, "cost", None)
        if isinstance(cost, (int, float)):
            self._reported_cost_usd = (self._reported_cost_usd or 0.0) + float(cost)

    async def _ensure_session(self) -> Any:
        if self._session is not None:
            return self._session

        # The factory is synchronous, so the client arrives un-started and is
        # booted here on the first turn. start() spawns the bundled Copilot
        # CLI in server mode and the SDK talks to it over JSON-RPC.
        await self._client.start()

        sdk_tools = [
            copilot.Tool(
                name=definition.name,
                description=definition.description,
                parameters=dict(definition.parameters),
                handler=self._make_handler(definition.name),
                skip_permission=True,
            )
            for definition in self._tool_definitions
        ]

        kwargs: Dict[str, Any] = {
            "model": get_copilot_api_name(self._model),
            "tools": sdk_tools,
            "streaming": True,
            "on_event": self._on_session_event,
            # shot2code supplies its own tools; Copilot's built-in file and
            # shell tools would edit the developer's disk. ToolSet classifies
            # by registration source, so allowing "custom:*" keeps our tools
            # while every built-in stays out.
            "available_tools": copilot.ToolSet().add_custom("*"),
            "skip_custom_instructions": True,
            "enable_config_discovery": False,
        }
        if self._system_prompt:
            kwargs["system_message"] = {
                "mode": "replace",
                "content": self._system_prompt,
            }
        reasoning_effort = get_copilot_reasoning_effort(self._model)
        if reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort

        self._session = await self._client.create_session(**kwargs)
        return self._session

    async def _run_send(self) -> str:
        session = await self._ensure_session()
        # send() only enqueues and hands back a message id; send_and_wait blocks
        # until the agent goes idle while still delivering events to handlers.
        final_event = await session.send_and_wait(
            self._prompt,
            attachments=self._attachments or None,
            timeout=_SEND_TIMEOUT_SECONDS,
        )
        return _extract_event_text(final_event)

    async def _start_if_needed(self) -> None:
        if self._started:
            return
        self._started = True
        await self._ensure_session()

        async def runner() -> None:
            try:
                text = await self._run_send()
                await self._queue.put((_TAG_DONE, text or ""))
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # surfaced to the engine via stream_turn
                await self._queue.put((_TAG_ERROR, exc))

        self._send_task = asyncio.ensure_future(runner())

    async def stream_turn(self, on_event: EventSink) -> ProviderTurn:
        await self._start_if_needed()

        assistant_text_parts: List[str] = []

        while True:
            tag, payload = await self._queue.get()

            if tag == _TAG_TEXT:
                assistant_text_parts.append(payload)
                await on_event(StreamEvent(type="assistant_delta", text=payload))
                continue

            if tag == _TAG_THINKING:
                await on_event(StreamEvent(type="thinking_delta", text=payload))
                continue

            if tag == _TAG_ERROR:
                raise payload

            if tag == _TAG_DONE:
                assistant_text = "".join(assistant_text_parts) or payload
                if self._recorder is not None:
                    self._recorder.record_llm_response(assistant_text, [], None)
                return ProviderTurn(
                    assistant_text=assistant_text,
                    tool_calls=[],
                    assistant_turn=None,
                )

            if tag == _TAG_TOOL:
                pendings: List[_PendingToolCall] = [payload]
                # Drain any tool calls the agent issued in the same batch so
                # they execute together instead of one engine turn each.
                while True:
                    try:
                        next_tag, next_payload = self._queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
                    if next_tag == _TAG_TOOL:
                        pendings.append(next_payload)
                        continue
                    # Not a tool call - put it back for the next turn.
                    self._queue.put_nowait((next_tag, next_payload))
                    break

                tool_calls = [pending.tool_call for pending in pendings]
                for tool_call in tool_calls:
                    await on_event(
                        StreamEvent(
                            type="tool_call_delta",
                            tool_call_id=tool_call.id,
                            tool_name=tool_call.name,
                            tool_arguments=tool_call.arguments,
                        )
                    )

                assistant_text = "".join(assistant_text_parts)
                if self._recorder is not None:
                    self._recorder.record_llm_response(assistant_text, tool_calls, None)

                return ProviderTurn(
                    assistant_text=assistant_text,
                    tool_calls=tool_calls,
                    assistant_turn=pendings,
                )

    async def append_tool_results(
        self,
        turn: ProviderTurn,
        executed_tool_calls: List[ExecutedToolCall],
    ) -> None:
        for executed in executed_tool_calls:
            pending = self._pending.pop(executed.tool_call.id, None)
            if pending is None:
                continue
            if not pending.future.done():
                # Releases the parked Copilot tool handler so its agent loop
                # continues with the result shot2code produced.
                pending.future.set_result(executed.result)

    def total_cost_usd(self) -> Optional[float]:
        # Copilot bills premium *requests* against the user's subscription, so
        # the usage event's `cost` is a request count, not dollars. Reporting it
        # as USD made the engine abort a normal run against
        # GENERATION_MAX_COST_USD. There is no per-token spend to cap here, so
        # return None and leave the run unbounded by that ceiling.
        return None

    async def close(self) -> None:
        for pending in self._pending.values():
            if not pending.future.done():
                pending.future.cancel()
        self._pending.clear()

        if self._send_task is not None and not self._send_task.done():
            self._send_task.cancel()
            try:
                await self._send_task
            except (asyncio.CancelledError, Exception):
                pass

        if self._session is not None:
            try:
                await self._session.disconnect()
            except Exception:
                pass

        if self._client_owned:
            try:
                await self._client.stop()
                # Give the CLI subprocess transport a chance to finish closing
                # before the loop can go away, otherwise its __del__ fires
                # after loop shutdown and logs "Event loop is closed".
                await asyncio.sleep(0)
            except Exception:
                pass

        u = self._total_usage
        print(
            f"[TOKEN USAGE] provider=copilot model={get_copilot_api_name(self._model)} | "
            f"input={u.input} output={u.output} "
            f"cache_read={u.cache_read} cache_write={u.cache_write} total={u.total}"
        )
