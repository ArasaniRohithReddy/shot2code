"""Turning validated integrations into Copilot SDK inputs.

Three jobs live here, all of them the boundary between shot2code's own types
and the SDK's:

* :func:`build_provider_config` - the BYOK *connection* plus the base model of
  one selection become a ``ProviderConfig``. The connection's own credential is
  the only one considered: a direct OpenAI/Anthropic key belongs to the direct
  provider runtime and is never borrowed, so enabling BYOK can never change how
  those keys behave.
* :func:`build_mcp_servers` - trusted servers become the SDK's MCP config map.
* :func:`build_permission_handler` - a deny-by-default handler. MCP permissions
  are denied unless the request names a trusted server, and a write tool needs
  that server to have been marked ``allowWriteTools``. Every other permission
  request the runtime can raise is rejected - including the ``url`` request a
  network-capable built-in raises - and ``approve_all`` is never used.

The handler is installed on **every** Copilot session, not only sessions with
MCP servers. Without it the runtime falls back to its own default policy, so a
run that enables a network-capable built-in would have no shot2code-owned
answer to "may this URL be fetched?".
"""

from __future__ import annotations

import json
import os
from typing import Any, Literal, Mapping, Optional
from urllib.parse import urlsplit

import copilot
from copilot.rpc import PermissionDecisionApproveOnce, PermissionDecisionReject
from copilot.session_events import PermissionRequestMcp

try:  # pragma: no cover - depends on the installed SDK version
    from copilot.session_events import PermissionRequestUrl
except ImportError:  # pragma: no cover - older SDKs have no URL request type
    PermissionRequestUrl = None  # type: ignore[assignment]

from integrations.config import (
    ByokConnection,
    IntegrationConfigError,
    McpServerSettings,
    redact_mapping,
)
from llm import Llm, get_anthropic_api_name, get_openai_api_name, provider_for_model

# Displayed name for a tool the SDK ran inside its own loop, so the activity
# feed never confuses it with one of shot2code's own tools.
MCP_DISPLAY_PREFIX = "MCP"

# Tool output is model-facing and can be large; the activity feed only needs
# enough to recognise what happened.
MAX_TOOL_OUTPUT_CHARS = 600
MAX_PROGRESS_CHARS = 240

# --------------------------------------------------------------------------- #
# Copilot's network-capable built-ins
# --------------------------------------------------------------------------- #

# ``web_fetch`` is a real built-in in the bundled runtime: it appears in the
# runtime's own tool vocabulary and in its ``SandboxDecision`` tool-kind enum
# next to ``shell``, ``search``, ``mcp`` and ``lsp``, and
# ``ToolSet().add_builtin("web_fetch")`` would therefore target it the same way
# ``web_search`` and ``skill`` are targeted today.
#
# shot2code still does not offer it, for one reason that is not a matter of
# taste: **its output cannot be bounded.**
#
# A built-in's result is produced inside the runtime and handed to the model by
# the runtime. The SDK exposes it to a host only as a *notification*
# (``tool.execution_complete``), which arrives after the model has already been
# given the text - there is no hook to truncate it, cap it, or prefix it with
# an untrusted-content warning. ``web_fetch`` returns the body of an arbitrary
# page, so enabling it would put an unbounded, unlabelled, third-party document
# straight into the model's context.
#
# That is exactly the route the canonical ``search_web`` tool exists to avoid:
# shot2code owns that result, so it can enforce a result count, a snippet
# length, a total size, per-turn and per-generation budgets, and an explicit
# "this is untrusted" prefix. Offering an unbounded built-in beside it would
# hand a model the way around all of them.
#
# Two further gaps, either of which would be enough on its own:
#
# * **No URL scoping.** The runtime protocol has a ``PermissionUrlsConfig``
#   (``initial_allowed`` / ``unrestricted``), but the SDK's ``create_session``
#   takes no parameter for it, so a session cannot be created with an allowed
#   URL list. The only control is per-request approval (below), which is
#   all-or-nothing per URL and cannot express "this run may read docs.foo.com".
# * **No cost or rate budget.** A built-in call is not counted by shot2code, so
#   the per-turn and per-generation ceilings that bound ``search_web`` do not
#   apply to it.
#
# What would change this: an SDK that either lets a host post-process a
# built-in result before the model sees it, or accepts a URL allowlist at
# session creation. Until then the honest answer is "not offered", said in the
# UI rather than discovered by a user whose run quietly fetched a page.
COPILOT_BUILTIN_WEB_FETCH_SUPPORTED = False

COPILOT_WEB_FETCH_DISABLED_REASON = (
    "Copilot's built-in web_fetch returns the full contents of a page straight "
    "to the model, and the SDK gives shot2code no way to bound, label or "
    "budget that text before the model reads it. Use web search (all models), "
    "whose results are capped and marked as untrusted."
)

# Built-in tools shot2code will never add to a session's ToolSet, whatever the
# settings say. Kept as data so the guard is testable and so adding a built-in
# is a deliberate edit rather than a forgotten branch.
BLOCKED_BUILTIN_TOOLS: frozenset[str] = frozenset({"web_fetch"})


def builtin_tool_blocked_reason(name: str) -> str | None:
    """Why this built-in is not offered, or ``None`` when it may be."""
    if name == "web_fetch":
        return COPILOT_WEB_FETCH_DISABLED_REASON
    if name in BLOCKED_BUILTIN_TOOLS:
        return f"shot2code does not offer the built-in '{name}'."
    return None


def blocked_builtins_in(tool_set: Any) -> list[str]:
    """Blocked built-in names a ToolSet would send on the wire.

    ``ToolSet`` accumulates ``builtin:<name>`` strings, so the check reads the
    entries it will actually transmit rather than trusting the call sites that
    built it.
    """
    try:
        entries = list(tool_set.to_list())
    except AttributeError:
        entries = list(tool_set or [])
    found: list[str] = []
    for entry in entries:
        if not isinstance(entry, str) or not entry.startswith("builtin:"):
            continue
        name = entry.removeprefix("builtin:")
        if name == "*":
            # A wildcard would pull in every built-in, blocked ones included.
            found.extend(sorted(BLOCKED_BUILTIN_TOOLS))
        elif name in BLOCKED_BUILTIN_TOOLS:
            found.append(name)
    return found


def assert_no_blocked_builtins(tool_set: Any) -> Any:
    """Return ``tool_set`` unchanged, or refuse to build the session.

    A blocked built-in reaching the wire is a decision this code has documented
    it cannot honour, so it fails loudly here rather than silently granting a
    capability whose output shot2code cannot bound.
    """
    blocked = blocked_builtins_in(tool_set)
    if blocked:
        reasons = "; ".join(
            builtin_tool_blocked_reason(name) or name for name in blocked
        )
        raise ValueError(
            f"Refusing to enable Copilot built-in(s) {', '.join(blocked)}: {reasons}"
        )
    return tool_set


def mcp_tool_display_name(server_name: str, tool_name: str) -> str:
    return f"{MCP_DISPLAY_PREFIX} · {server_name} · {tool_name}"


def _is_loopback_endpoint(base_url: Optional[str]) -> bool:
    if not base_url:
        return False
    host = urlsplit(base_url).hostname or ""
    return host in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def base_model_api_name(model: Llm) -> str:
    """The provider-side name of a selection's base model.

    This is what the runtime looks capabilities up by. What the endpoint is
    actually asked for is the connection's ``wire_model`` when the deployment
    is named differently.
    """
    if provider_for_model(model) == "anthropic":
        return get_anthropic_api_name(model)
    return get_openai_api_name(model)


def build_provider_config(
    connection: ByokConnection,
    model: Llm,
    wire_model: str | None = None,
) -> "copilot.ProviderConfig":
    """The SDK provider configuration for one BYOK selection.

    ``model_id`` stays a model the runtime knows, because that is what it looks
    prompt shape and token limits up by. ``wire_model`` is what the endpoint is
    actually asked for - an Azure deployment name, or whatever model the
    operator deployed on a standards-compatible endpoint, which the catalog has
    never heard of. The selection's wire model wins over the connection's, so a
    custom identity always sends the name it was built from.
    """
    reason = connection.unusable_reason
    if reason is not None:
        raise IntegrationConfigError(f"Copilot SDK BYOK {reason}.")
    if not connection.serves(model):
        raise IntegrationConfigError(
            f"Copilot SDK BYOK is a {connection.provider} connection, so it "
            f"cannot run {model.value}."
        )

    served = wire_model or connection.wire_model

    config: "copilot.ProviderConfig" = {
        "type": connection.provider,
        "wire_api": connection.wire_api,
        "model_id": base_model_api_name(model),
    }
    if connection.base_url:
        config["base_url"] = connection.base_url
    # A bearer token sets the Authorization header directly and takes
    # precedence in the SDK, so only one of the two is ever sent.
    if connection.bearer_token:
        config["bearer_token"] = connection.bearer_token
    elif connection.api_key:
        config["api_key"] = connection.api_key
    if served:
        config["wire_model"] = served
    if connection.provider == "azure" and connection.azure_api_version:
        config["azure"] = {"api_version": connection.azure_api_version}
    return config


def build_mcp_servers(
    servers: tuple[McpServerSettings, ...] | list[McpServerSettings],
) -> dict[str, "copilot.MCPServerConfig"]:
    """SDK MCP configuration for servers that are enabled *and* trusted."""
    configured: dict[str, "copilot.MCPServerConfig"] = {}
    for server in servers:
        if not server.is_active:
            continue
        # "*" is the SDK's all-tools marker; an empty list would disable the
        # server entirely, which is not what "no filter configured" means.
        tools = list(server.tools) if server.tools else ["*"]
        if server.transport == "stdio":
            stdio: "copilot.MCPStdioServerConfig" = {
                "type": "local",
                "command": server.command or "",
                "tools": tools,
            }
            if server.args:
                stdio["args"] = list(server.args)
            if server.env:
                stdio["env"] = dict(server.env)
            if server.working_directory:
                stdio["working_directory"] = server.working_directory
            if server.timeout_ms is not None:
                stdio["timeout"] = server.timeout_ms
            configured[server.key] = stdio
            continue

        http: "copilot.MCPHTTPServerConfig" = {
            "type": server.transport,
            "url": server.url or "",
            "tools": tools,
        }
        if server.headers:
            http["headers"] = dict(server.headers)
        if server.timeout_ms is not None:
            http["timeout"] = server.timeout_ms
        configured[server.key] = http
    return configured


PermissionOutcome = Literal["approved", "rejected"]

# A URL in a denial reason is echoed back to the model and into the run log, so
# it is bounded and stripped of anything credential-shaped first.
MAX_DENIED_URL_CHARS = 120


def describe_permission_url(url: object) -> str:
    """A denial-safe rendering of the URL a request wanted to reach."""
    if not isinstance(url, str) or not url.strip():
        return "an unnamed URL"
    candidate = url.strip()
    parts = urlsplit(candidate)
    if parts.scheme and parts.hostname:
        # Scheme and host are what a user needs to judge egress; a query string
        # can carry a token, so the path is kept only up to the bound.
        rendered = f"{parts.scheme}://{parts.hostname}{parts.path or ''}"
    else:
        rendered = candidate
    if len(rendered) > MAX_DENIED_URL_CHARS:
        return rendered[:MAX_DENIED_URL_CHARS] + "…"
    return rendered


def _is_url_request(request: Any) -> bool:
    """Whether this is the runtime's "may I fetch this URL?" request.

    Matched by type when the SDK exposes one, and by shape otherwise, so an
    SDK upgrade that renames the class cannot quietly turn a URL request into
    the generic branch.
    """
    if PermissionRequestUrl is not None and isinstance(request, PermissionRequestUrl):
        return True
    return getattr(request, "kind", None) == "url" or (
        hasattr(request, "url") and hasattr(request, "intention")
    )


def decide_mcp_permission(
    request: Any,
    servers: Mapping[str, McpServerSettings],
) -> tuple[PermissionOutcome, str]:
    """The decision, and the reason, for one SDK permission request.

    Split out from the handler so the policy can be tested without an SDK
    session. Deny by default: anything that is not an MCP request for a
    configured, trusted server is rejected.
    """
    # A network-capable built-in asks for a URL rather than a tool. It is named
    # explicitly so the denial says *which* address was refused and why,
    # instead of the generic "'url' requests are denied" a user cannot act on.
    if _is_url_request(request):
        target = describe_permission_url(getattr(request, "url", None))
        return "rejected", (
            f"shot2code does not fetch URLs through Copilot's built-in tools, "
            f"so {target} was not requested. {COPILOT_WEB_FETCH_DISABLED_REASON}"
        )

    is_mcp = isinstance(request, PermissionRequestMcp) or (
        getattr(request, "kind", None) == "mcp"
        and hasattr(request, "server_name")
        and hasattr(request, "tool_name")
    )
    if not is_mcp:
        kind = getattr(request, "kind", "unknown")
        return "rejected", (
            f"shot2code only approves MCP tool calls; '{kind}' requests are denied."
        )

    if getattr(request, "managed_approval_required", False) is True:
        return "rejected", (
            "This tool call needs managed approval, which shot2code cannot grant."
        )

    server_name = str(getattr(request, "server_name", "") or "")
    server = servers.get(server_name)
    if server is None:
        return "rejected", (
            f"'{server_name}' is not a trusted MCP server in this run."
        )

    if bool(getattr(request, "read_only", False)):
        return "approved", f"read-only tool on trusted server '{server.name}'"

    if server.allow_write_tools:
        return "approved", f"write tool allowed on trusted server '{server.name}'"

    tool_name = str(getattr(request, "tool_name", "") or "tool")
    return "rejected", (
        f"'{tool_name}' modifies state and '{server.name}' is not allowed to run "
        "write tools. Enable write tools for that server to permit it."
    )


def build_permission_handler(
    servers: tuple[McpServerSettings, ...] | list[McpServerSettings],
):
    """A deny-by-default permission handler for one Copilot SDK session.

    Installed on every Copilot session, including one with no MCP servers:
    without a handler the runtime applies its own default policy, and a run
    that enables a network-capable built-in would have no shot2code-owned
    answer to "may this URL be fetched?".
    """
    trusted = {server.key: server for server in servers if server.is_active}

    def handle(request: Any, invocation: Any) -> Any:
        outcome, reason = decide_mcp_permission(request, trusted)
        if outcome == "approved":
            return PermissionDecisionApproveOnce()
        return PermissionDecisionReject(feedback=reason)

    return handle


def redact_tool_arguments(arguments: Any) -> Any:
    """Tool arguments with credential-shaped keys masked, ready to display."""
    if isinstance(arguments, str):
        try:
            parsed = json.loads(arguments)
        except (TypeError, ValueError):
            return arguments
        return redact_tool_arguments(parsed)
    if isinstance(arguments, Mapping):
        redacted = redact_mapping(arguments)  # pyright: ignore[reportUnknownArgumentType]
        return {
            key: redact_tool_arguments(value) if not isinstance(value, str) else value
            for key, value in redacted.items()
        }
    if isinstance(arguments, list):
        return [redact_tool_arguments(item) for item in arguments]  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
    return arguments


def summarize_tool_output(text: str, limit: int = MAX_TOOL_OUTPUT_CHARS) -> str:
    """A bounded one-line-ish summary of MCP output for the activity feed."""
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return f"{collapsed[:limit]}… ({len(collapsed)} chars)"


def copilot_base_directory() -> str:
    """Per-install storage for SDK sessions started in ``mode='empty'``.

    Empty mode refuses to fall back to ``~/.copilot``, so BYOK sessions need an
    explicit directory. It lives under shot2code's own application data so a
    BYOK run never shares state with the user's Copilot CLI login.
    """
    override = os.environ.get("SHOT2CODE_APP_DATA_DIR")
    if override:
        root = override
    elif os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        root = os.path.join(base, "shot2code")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.join(
            os.path.expanduser("~"), ".local", "share"
        )
        root = os.path.join(base, "shot2code")
    return os.path.join(root, "copilot-sdk")
