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
  request the runtime can raise is rejected, and ``approve_all`` is never used.
"""

from __future__ import annotations

import json
import os
from typing import Any, Literal, Mapping, Optional
from urllib.parse import urlsplit

import copilot
from copilot.rpc import PermissionDecisionApproveOnce, PermissionDecisionReject
from copilot.session_events import PermissionRequestMcp

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


def decide_mcp_permission(
    request: Any,
    servers: Mapping[str, McpServerSettings],
) -> tuple[PermissionOutcome, str]:
    """The decision, and the reason, for one SDK permission request.

    Split out from the handler so the policy can be tested without an SDK
    session. Deny by default: anything that is not an MCP request for a
    configured, trusted server is rejected.
    """
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
    """A deny-by-default permission handler for one Copilot SDK session."""
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
