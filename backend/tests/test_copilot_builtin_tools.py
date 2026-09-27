"""Copilot's network-capable built-ins: what is offered, and what is refused.

The decision these lock in is ``web_fetch`` **off**, for a reason that is a
property of the SDK rather than a preference: a built-in's result is handed to
the model by the runtime, and the SDK exposes it to a host only as an
after-the-fact notification, so shot2code cannot bound, label or budget it.

Evidence behind the decision, verified against the installed SDK:

* ``web_fetch`` *is* a real runtime built-in - it appears in the bundled
  runtime's tool vocabulary and in its ``SandboxDecision`` tool-kind enum, so
  ``ToolSet().add_builtin("web_fetch")`` would target it.
* The runtime *does* raise a URL permission request - the SDK's
  ``PermissionRequest`` union includes ``PermissionRequestUrl`` with ``url``,
  ``intention`` and ``redirected_from``.
* But ``create_session`` takes **no** URL-allowlist parameter, and there is no
  hook to post-process a built-in result.

So the tests below assert the two halves that make "not offered" true rather
than aspirational: the tool never reaches the wire, and the permission handler
that would be asked is installed on every session and says no.
"""

from typing import Any

import pytest

import copilot
from agent.providers.github_copilot import CopilotProviderSession
from integrations.config import McpServerSettings
from integrations.copilot_sdk import (
    BLOCKED_BUILTIN_TOOLS,
    COPILOT_BUILTIN_WEB_FETCH_SUPPORTED,
    COPILOT_WEB_FETCH_DISABLED_REASON,
    assert_no_blocked_builtins,
    blocked_builtins_in,
    build_permission_handler,
    builtin_tool_blocked_reason,
    decide_mcp_permission,
    describe_permission_url,
)
from llm import Llm


class _UrlRequest:
    """The shape the runtime sends for "may I fetch this URL?"."""

    kind = "url"

    def __init__(self, url: str, intention: str = "fetch page") -> None:
        self.url = url
        self.intention = intention
        self.redirected_from: str | None = None
        self.managed_approval_required = False
        self.tool_call_id = "call-1"


class _McpRequest:
    kind = "mcp"

    def __init__(self, server_name: str, tool_name: str, read_only: bool) -> None:
        self.server_name = server_name
        self.tool_name = tool_name
        self.read_only = read_only
        self.managed_approval_required = False


def _session(**kwargs: Any) -> CopilotProviderSession:
    return CopilotProviderSession(
        client=object(),  # type: ignore[arg-type]
        model=Llm.CLAUDE_OPUS_4_8_HIGH,
        prompt_messages=[{"role": "user", "content": "hi"}],
        tools=[],
        **kwargs,
    )


# --------------------------------------------------------------------------- #
# The decision itself
# --------------------------------------------------------------------------- #


def test_web_fetch_is_declared_unsupported_with_a_reason() -> None:
    assert COPILOT_BUILTIN_WEB_FETCH_SUPPORTED is False
    assert "web_fetch" in BLOCKED_BUILTIN_TOOLS
    reason = builtin_tool_blocked_reason("web_fetch")
    assert reason == COPILOT_WEB_FETCH_DISABLED_REASON
    assert reason is not None
    # The reason must name the actual blocker, not a vague "unsupported".
    lowered = reason.lower()
    assert "bound" in lowered or "budget" in lowered
    assert "web search" in lowered


def test_a_built_in_we_do_offer_is_not_blocked() -> None:
    assert builtin_tool_blocked_reason("web_search") is None
    assert builtin_tool_blocked_reason("skill") is None


# --------------------------------------------------------------------------- #
# It never reaches the wire
# --------------------------------------------------------------------------- #


def test_web_fetch_is_absent_from_every_tool_set_configuration() -> None:
    combinations: list[dict[str, Any]] = [
        {},
        {"allow_web_search": True},
        {"skill_directories": ["/skills"]},
        {"mcp_servers": {"docs": {"type": "stdio", "command": "npx"}}},
        {
            "allow_web_search": True,
            "skill_directories": ["/skills"],
            "mcp_servers": {"docs": {"type": "stdio", "command": "npx"}},
        },
    ]
    for kwargs in combinations:
        entries = _session(**kwargs)._available_tools().to_list()
        assert "builtin:web_fetch" not in entries, kwargs
        # And no wildcard that would sweep it in either.
        assert "builtin:*" not in entries, kwargs


def test_enabling_copilot_web_search_does_not_enable_web_fetch() -> None:
    """The two are separate opt-ins; one must never imply the other."""
    entries = _session(allow_web_search=True)._available_tools().to_list()
    assert "builtin:web_search" in entries
    assert "builtin:web_fetch" not in entries


def test_web_search_stays_off_unless_it_was_asked_for() -> None:
    entries = _session()._available_tools().to_list()
    assert "builtin:web_search" not in entries
    assert entries == ["custom:*"]


def test_the_guard_detects_a_blocked_builtin_added_by_hand() -> None:
    tool_set = copilot.ToolSet().add_custom("*").add_builtin("web_fetch")
    assert blocked_builtins_in(tool_set) == ["web_fetch"]
    with pytest.raises(ValueError) as raised:
        assert_no_blocked_builtins(tool_set)
    assert "web_fetch" in str(raised.value)
    assert COPILOT_WEB_FETCH_DISABLED_REASON in str(raised.value)


def test_the_guard_detects_a_builtin_wildcard() -> None:
    # `builtin:*` would enable every built-in, web_fetch included.
    tool_set = copilot.ToolSet().add_builtin("*")
    assert "web_fetch" in blocked_builtins_in(tool_set)
    with pytest.raises(ValueError):
        assert_no_blocked_builtins(tool_set)


def test_the_guard_passes_the_sets_we_actually_build() -> None:
    allowed = copilot.ToolSet().add_custom("*").add_builtin("web_search")
    assert blocked_builtins_in(allowed) == []
    assert assert_no_blocked_builtins(allowed) is allowed


# --------------------------------------------------------------------------- #
# The permission handler says no, on every session
# --------------------------------------------------------------------------- #


def test_a_url_request_is_denied_with_an_actionable_reason() -> None:
    outcome, reason = decide_mcp_permission(
        _UrlRequest("https://example.com/docs/page"), {}
    )
    assert outcome == "rejected"
    assert "example.com" in reason
    assert COPILOT_WEB_FETCH_DISABLED_REASON in reason


def test_a_url_denial_does_not_echo_a_query_string() -> None:
    # Provider errors and tool arguments routinely carry tokens in a query.
    outcome, reason = decide_mcp_permission(
        _UrlRequest("https://example.com/cb?access_token=supersecretvalue"), {}
    )
    assert outcome == "rejected"
    assert "supersecretvalue" not in reason


def test_a_url_denial_is_bounded() -> None:
    long_url = "https://example.com/" + ("segment/" * 200)
    _, reason = decide_mcp_permission(_UrlRequest(long_url), {})
    assert len(reason) < 600


def test_a_url_request_is_denied_even_with_trusted_mcp_servers() -> None:
    server = McpServerSettings(
        id="docs",
        key="docs",
        name="Docs",
        enabled=True,
        trusted=True,
        transport="stdio",
        command="npx",
    )
    outcome, _ = decide_mcp_permission(
        _UrlRequest("https://example.com/"), {server.key: server}
    )
    assert outcome == "rejected"


def test_a_url_request_is_recognised_by_shape_not_just_by_type() -> None:
    """An SDK rename must not silently drop it into the generic branch."""

    class _Renamed:
        url = "https://example.com/"
        intention = "fetch"

    outcome, reason = decide_mcp_permission(_Renamed(), {})
    assert outcome == "rejected"
    assert "example.com" in reason


def test_mcp_permissions_still_work_exactly_as_before() -> None:
    server = McpServerSettings(
        id="docs",
        key="docs",
        name="Docs",
        enabled=True,
        trusted=True,
        transport="stdio",
        command="npx",
    )
    trusted = {server.key: server}
    approved, _ = decide_mcp_permission(
        _McpRequest(server.key, "search", read_only=True), trusted
    )
    assert approved == "approved"
    rejected, _ = decide_mcp_permission(
        _McpRequest(server.key, "write_file", read_only=False), trusted
    )
    assert rejected == "rejected"


def test_the_handler_rejects_a_url_request_with_feedback() -> None:
    handler = build_permission_handler([])
    decision = handler(_UrlRequest("https://example.com/"), None)
    assert type(decision).__name__ == "PermissionDecisionReject"
    assert "example.com" in getattr(decision, "feedback", "")


def test_a_handler_exists_even_with_no_mcp_servers() -> None:
    # Without a handler the runtime falls back to its own default policy, so
    # "shot2code does not fetch URLs" would be an assumption, not a rule.
    handler = build_permission_handler([])
    assert callable(handler)
    decision = handler(_UrlRequest("https://example.com/"), None)
    assert type(decision).__name__ == "PermissionDecisionReject"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://example.com/a", "https://example.com/a"),
        ("https://example.com/a?token=x", "https://example.com/a"),
        ("", "an unnamed URL"),
        (None, "an unnamed URL"),
        ("not a url", "not a url"),
    ],
)
def test_url_descriptions_are_safe(url: Any, expected: str) -> None:
    assert describe_permission_url(url) == expected


# --------------------------------------------------------------------------- #
# Native providers never see a Copilot built-in at all
# --------------------------------------------------------------------------- #


def test_no_canonical_tool_is_named_after_a_copilot_builtin() -> None:
    """Native OpenAI/Anthropic/Gemini runs get canonical tools only.

    A Copilot built-in is a runtime capability, not a tool definition, so it
    cannot be serialized to a native provider. This asserts the corollary the
    UI relies on: no canonical tool borrows the name, so nothing on a native
    run can look like ``web_fetch`` to a user reading the activity feed.
    """
    from agent.tools.definitions import canonical_tool_definitions

    names = {
        definition.name
        for definition in canonical_tool_definitions(
            image_generation_enabled=True,
            image_editing_enabled=True,
            asset_extraction_enabled=True,
            screenshot_enabled=True,
            web_search_enabled=True,
        )
    }
    assert "web_fetch" not in names
    assert "web_search" not in names
    # The provider-neutral path keeps its own distinct name, so it can never
    # collide with either built-in.
    assert "search_web" in names
