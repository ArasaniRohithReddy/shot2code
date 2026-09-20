"""Turning a validated connection into Copilot SDK inputs, and the permission policy.

The SDK is an agent runtime: what it is handed (provider connection, MCP server
map, tool allowlist) and what it is allowed to do (the permission handler) are
the whole security surface of this feature, so both are pinned here.
"""

from typing import Any, cast

import pytest

from copilot.rpc import PermissionDecisionApproveOnce, PermissionDecisionReject
from copilot.session_events import (
    PermissionRequestMcp,
    PermissionRequestRead,
    PermissionRequestShell,
)
from integrations.config import (
    ByokConnection,
    IntegrationConfigError,
    McpServerSettings,
    parse_integration_settings,
)
from integrations.copilot_sdk import (
    base_model_api_name,
    build_mcp_servers,
    build_permission_handler,
    build_provider_config,
    copilot_base_directory,
    decide_mcp_permission,
    mcp_tool_display_name,
    redact_tool_arguments,
    summarize_tool_output,
)
from llm import Llm

OPENAI_BASE = Llm.GPT_5_6_SOL_HIGH
ANTHROPIC_BASE = Llm.CLAUDE_OPUS_5_MAX


def connection(**overrides: object) -> ByokConnection:
    block: dict[str, object] = {
        "enabled": True,
        "provider": "openai",
        "baseUrl": "https://api.example.com/v1",
        "apiKey": "sk-byok",
    }
    block.update(overrides)
    settings = parse_integration_settings({"copilotSdkByok": block})
    assert settings.byok is not None
    return settings.byok


def provider_config(conn: ByokConnection, model: Llm) -> dict[str, Any]:
    """``build_provider_config`` as a plain dict, so optional keys can be read."""
    return cast(dict[str, Any], build_provider_config(conn, model))


def mcp_config(servers: Any) -> dict[str, dict[str, Any]]:
    return cast(dict[str, dict[str, Any]], build_mcp_servers(servers))


def server(**fields: object) -> McpServerSettings:
    payload: dict[str, object] = {
        "id": "srv",
        "name": "Docs",
        "enabled": True,
        "trusted": True,
        "transport": "stdio",
        "command": "npx",
    }
    payload.update(fields)
    settings = parse_integration_settings({"mcpServers": [payload]})
    return settings.mcp_servers[0]


class TestProviderConfigConversion:
    def test_an_openai_connection_keeps_the_base_model_as_model_id(self) -> None:
        config = provider_config(connection(), OPENAI_BASE)

        assert config["type"] == "openai"
        assert config["wire_api"] == "responses"
        assert config["base_url"] == "https://api.example.com/v1"
        assert config["api_key"] == "sk-byok"
        # The selection is sdk-byok/openai/<model>; the endpoint is still asked
        # for the provider's own model name.
        assert config["model_id"] == "gpt-5.6-sol"
        assert "wire_model" not in config

    def test_wire_model_overrides_only_the_endpoint_model(self) -> None:
        config = provider_config(
            connection(wireModel="gpt-sol-deployment"), OPENAI_BASE
        )

        assert config["model_id"] == "gpt-5.6-sol"
        assert config["wire_model"] == "gpt-sol-deployment"

    def test_azure_carries_its_endpoint_and_api_version(self) -> None:
        config = provider_config(
            connection(
                provider="azure",
                baseUrl="https://my-resource.openai.azure.com",
                apiKey="azure-key",
                azureApiVersion="2026-04-01-preview",
            ),
            Llm.GPT_5_5_HIGH,
        )

        assert config["type"] == "azure"
        assert config["azure"] == {"api_version": "2026-04-01-preview"}
        assert config["base_url"] == "https://my-resource.openai.azure.com"
        assert config["model_id"] == "gpt-5.5"

    def test_anthropic_uses_the_anthropic_model_name(self) -> None:
        config = provider_config(
            connection(provider="anthropic", baseUrl=None, apiKey="sk-ant-byok"),
            ANTHROPIC_BASE,
        )

        assert config["type"] == "anthropic"
        assert config["model_id"] == "claude-opus-5"
        assert config["api_key"] == "sk-ant-byok"

    def test_a_bearer_token_wins_over_an_api_key(self) -> None:
        config = provider_config(
            connection(apiKey="sk-byok", bearerToken="token-value"), OPENAI_BASE
        )

        assert config["bearer_token"] == "token-value"
        assert "api_key" not in config

    def test_a_local_endpoint_may_omit_a_credential(self) -> None:
        config = provider_config(
            connection(baseUrl="http://localhost:11434/v1", apiKey=None), OPENAI_BASE
        )

        assert "api_key" not in config
        assert "bearer_token" not in config

    def test_an_incomplete_connection_is_refused(self) -> None:
        with pytest.raises(IntegrationConfigError) as excinfo:
            build_provider_config(connection(apiKey=None), OPENAI_BASE)

        assert "API key" in str(excinfo.value)

    def test_a_model_the_connection_cannot_serve_is_refused(self) -> None:
        with pytest.raises(IntegrationConfigError) as excinfo:
            build_provider_config(connection(), ANTHROPIC_BASE)

        assert "cannot run" in str(excinfo.value)

    def test_gemini_can_never_be_built(self) -> None:
        with pytest.raises(IntegrationConfigError):
            build_provider_config(connection(), Llm.GEMINI_3_6_FLASH_LOW)

    def test_the_base_model_name_is_exposed_for_the_session(self) -> None:
        assert base_model_api_name(OPENAI_BASE) == "gpt-5.6-sol"
        assert base_model_api_name(ANTHROPIC_BASE) == "claude-opus-5"


class TestDirectCredentialsAreNeverBorrowed:
    """A direct key belongs to the direct runtime; BYOK must not reach for it."""

    def test_build_provider_config_takes_only_the_connection_and_model(self) -> None:
        import inspect

        signature = inspect.signature(build_provider_config)

        assert list(signature.parameters) == ["connection", "model"]

    def test_no_key_fallback_helper_exists(self) -> None:
        import integrations.copilot_sdk as sdk_module

        assert not hasattr(sdk_module, "_resolve_credentials")
        assert not hasattr(sdk_module, "supports_model")

    def test_a_connection_without_its_own_key_cannot_be_completed_elsewhere(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("OPENAI_API_KEY", "sk-direct-should-not-be-used")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-should-not-be-used")

        with pytest.raises(IntegrationConfigError):
            build_provider_config(connection(apiKey=None), OPENAI_BASE)


class TestMcpServerConversion:
    def test_stdio_servers_become_local_sdk_entries(self) -> None:
        configured = mcp_config(
            [
                server(
                    name="Docs Server",
                    args=["-y", "docs"],
                    env={"DOCS_TOKEN": "secret"},
                    workingDirectory="C:/tmp/docs",
                    timeoutMs=45_000,
                )
            ]
        )

        entry = configured["docs-server"]
        assert entry["type"] == "local"
        assert entry["command"] == "npx"
        assert entry["args"] == ["-y", "docs"]
        assert entry["env"] == {"DOCS_TOKEN": "secret"}
        assert entry["working_directory"] == "C:/tmp/docs"
        assert entry["timeout"] == 45_000
        # No tool filter configured means every tool, not none.
        assert entry["tools"] == ["*"]

    def test_remote_servers_become_http_or_sse_entries(self) -> None:
        configured = mcp_config(
            [
                server(
                    id="r",
                    name="Remote",
                    transport="sse",
                    command=None,
                    url="https://mcp.example.com/sse",
                    headers={"X-Api-Key": "secret"},
                )
            ]
        )

        entry = configured["remote"]
        assert entry["type"] == "sse"
        assert entry["url"] == "https://mcp.example.com/sse"
        assert entry["headers"] == {"X-Api-Key": "secret"}

    def test_a_tool_allowlist_is_passed_through_verbatim(self) -> None:
        configured = mcp_config([server(tools=["search", "fetch"])])

        assert configured["docs"]["tools"] == ["search", "fetch"]

    def test_disabled_and_untrusted_servers_are_not_configured(self) -> None:
        configured = mcp_config(
            [
                server(id="a", name="Trusted"),
                server(id="b", name="Disabled", enabled=False),
                server(id="c", name="Untrusted", trusted=False),
            ]
        )

        assert list(configured) == ["trusted"]


class TestPermissionPolicy:
    def mcp_request(self, **fields: object) -> PermissionRequestMcp:
        payload: dict[str, object] = {
            "readOnly": True,
            "serverName": "docs",
            "toolName": "search",
            "toolTitle": "Search",
        }
        payload.update(fields)
        return PermissionRequestMcp.from_dict(payload)

    def trusted(self, **fields: object) -> dict[str, McpServerSettings]:
        configured = server(**fields)
        return {configured.key: configured}

    def test_read_only_calls_on_a_trusted_server_are_approved(self) -> None:
        outcome, reason = decide_mcp_permission(self.mcp_request(), self.trusted())

        assert outcome == "approved"
        assert "read-only" in reason

    def test_write_calls_need_the_server_to_allow_them(self) -> None:
        outcome, reason = decide_mcp_permission(
            self.mcp_request(readOnly=False), self.trusted()
        )

        assert outcome == "rejected"
        assert "write tools" in reason

    def test_write_calls_are_approved_when_the_server_allows_writes(self) -> None:
        outcome, _ = decide_mcp_permission(
            self.mcp_request(readOnly=False), self.trusted(allowWriteTools=True)
        )

        assert outcome == "approved"

    def test_an_unknown_server_is_rejected(self) -> None:
        outcome, reason = decide_mcp_permission(
            self.mcp_request(serverName="somewhere-else"), self.trusted()
        )

        assert outcome == "rejected"
        assert "somewhere-else" in reason

    def test_managed_approval_requests_are_rejected(self) -> None:
        outcome, reason = decide_mcp_permission(
            self.mcp_request(managedApprovalRequired=True), self.trusted()
        )

        assert outcome == "rejected"
        assert "managed approval" in reason

    @pytest.mark.parametrize(
        "request_payload",
        [
            PermissionRequestShell(
                can_offer_session_approval=True,
                commands=[],
                full_command_text="rm -rf /",
                has_write_file_redirection=False,
                intention="cleanup",
                possible_paths=[],
                possible_urls=[],
            ),
            PermissionRequestRead(intention="read secrets", path="C:/secrets"),
        ],
    )
    def test_non_mcp_permission_requests_are_rejected(
        self, request_payload: object
    ) -> None:
        outcome, reason = decide_mcp_permission(request_payload, self.trusted())

        assert outcome == "rejected"
        assert "MCP" in reason

    def test_handler_returns_sdk_decisions_and_never_approves_everything(self) -> None:
        handler = build_permission_handler([server(name="Docs")])

        approved = handler(self.mcp_request(), {"session_id": "s"})
        rejected = handler(self.mcp_request(readOnly=False), {"session_id": "s"})

        assert isinstance(approved, PermissionDecisionApproveOnce)
        assert isinstance(rejected, PermissionDecisionReject)
        assert rejected.feedback

    def test_handler_ignores_servers_that_are_not_active(self) -> None:
        handler = build_permission_handler([server(name="Docs", trusted=False)])

        decision = handler(self.mcp_request(), {"session_id": "s"})

        assert isinstance(decision, PermissionDecisionReject)


class TestDisplayAndRedaction:
    def test_mcp_tools_are_named_with_their_server(self) -> None:
        assert mcp_tool_display_name("docs", "search") == "MCP · docs · search"

    def test_secret_arguments_are_masked(self) -> None:
        redacted = redact_tool_arguments(
            {
                "query": "roadmap",
                "api_key": "sk-1",
                "nested": {"authorization": "Bearer x", "page": 2},
                "list": [{"password": "hunter2"}],
            }
        )

        assert redacted["query"] == "roadmap"
        assert redacted["api_key"] == "[redacted]"
        assert redacted["nested"]["authorization"] == "[redacted]"
        assert redacted["nested"]["page"] == 2
        assert redacted["list"][0]["password"] == "[redacted]"

    def test_json_encoded_arguments_are_parsed_before_masking(self) -> None:
        redacted = redact_tool_arguments('{"token": "abc", "q": "hi"}')

        assert redacted == {"token": "[redacted]", "q": "hi"}

    def test_unparseable_arguments_are_left_alone(self) -> None:
        assert redact_tool_arguments("not json") == "not json"

    def test_output_is_bounded_and_collapsed(self) -> None:
        summary = summarize_tool_output("a" * 5000)

        assert len(summary) < 700
        assert summary.endswith("(5000 chars)")

    def test_short_output_is_returned_as_is(self) -> None:
        assert summarize_tool_output("ok\n  done") == "ok done"


class TestBaseDirectory:
    def test_the_base_directory_is_scoped_to_shot2code(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: object
    ) -> None:
        monkeypatch.setenv("SHOT2CODE_APP_DATA_DIR", str(tmp_path))

        directory = copilot_base_directory()

        assert directory.startswith(str(tmp_path))
        assert directory.endswith("copilot-sdk")

    def test_it_never_points_at_the_users_copilot_cli_state(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("SHOT2CODE_APP_DATA_DIR", raising=False)

        directory = copilot_base_directory()

        assert "shot2code" in directory
        assert not directory.rstrip("/\\").endswith(".copilot")
