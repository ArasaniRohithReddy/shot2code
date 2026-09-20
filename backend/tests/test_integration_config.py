"""Validation, limits and redaction for the BYOK connection and MCP servers.

Everything a user can put in Settings arrives as untrusted JSON, so the rules
that keep it safe are asserted here rather than inferred from the parser. The
central rule is that BYOK is *additive*: its own dedicated credential, its own
run identities, and no effect whatsoever on the direct provider settings.
"""

import pytest

from integrations.config import (
    BYOK_SELECTION_PREFIX,
    MAX_MCP_SERVERS,
    IntegrationConfigError,
    byok_selection_id,
    is_byok_selection_id,
    parse_byok_selection_id,
    parse_integration_settings,
    redact_mapping,
)
from llm import Llm

OPENAI_BASE = Llm.GPT_5_6_SOL_HIGH
ANTHROPIC_BASE = Llm.CLAUDE_OPUS_5_MAX


def byok(**overrides: object) -> dict[str, object]:
    block: dict[str, object] = {
        "enabled": True,
        "provider": "azure",
        "baseUrl": "https://res.openai.azure.com",
        "apiKey": "azure-secret",
    }
    block.update(overrides)
    return {"copilotSdkByok": block}


def stdio_server(**overrides: object) -> dict[str, object]:
    server: dict[str, object] = {
        "id": "srv-1",
        "name": "Docs",
        "enabled": True,
        "trusted": True,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@example/docs-mcp"],
    }
    server.update(overrides)
    return server


def http_server(**overrides: object) -> dict[str, object]:
    server: dict[str, object] = {
        "id": "srv-http",
        "name": "Remote",
        "enabled": True,
        "trusted": True,
        "transport": "http",
        "url": "https://mcp.example.com/sse",
    }
    server.update(overrides)
    return server


class TestRunIdentity:
    def test_an_identity_names_the_provider_and_the_base_model(self) -> None:
        identity = byok_selection_id("azure", OPENAI_BASE)

        assert identity == f"sdk-byok/azure/{OPENAI_BASE.value}"
        assert is_byok_selection_id(identity)

    def test_an_identity_round_trips(self) -> None:
        parsed = parse_byok_selection_id(byok_selection_id("anthropic", ANTHROPIC_BASE))

        assert parsed is not None
        assert parsed.provider == "anthropic"
        assert parsed.base_model is ANTHROPIC_BASE
        assert parsed.wire_model is None
        assert parsed.is_custom is False

    def test_an_identity_can_never_be_a_direct_model_id(self) -> None:
        """The prefix is what keeps the two runtimes from colliding."""
        assert not any(
            model.value.startswith(BYOK_SELECTION_PREFIX) for model in Llm
        )
        assert not is_byok_selection_id(OPENAI_BASE.value)

    @pytest.mark.parametrize(
        "value",
        [
            OPENAI_BASE.value,
            "sdk-byok/bedrock/" + OPENAI_BASE.value,
            "sdk-byok/azure/gpt-9000",
            "sdk-byok/azure",
            None,
            17,
        ],
    )
    def test_nonsense_identities_do_not_parse(self, value: object) -> None:
        assert parse_byok_selection_id(value) is None

    def test_the_same_base_model_has_two_distinct_identities(self) -> None:
        native = OPENAI_BASE.value
        sdk = byok_selection_id("openai", OPENAI_BASE)

        assert native != sdk


class TestConnectionValidation:
    def test_a_full_connection_is_usable(self) -> None:
        settings = parse_integration_settings(
            byok(wireApi="completions", wireModel="my-deployment")
        )

        connection = settings.byok
        assert connection is not None
        assert connection.is_usable
        assert connection.wire_api == "completions"
        assert connection.wire_model == "my-deployment"
        assert settings.usable_byok is connection

    def test_the_provider_decides_which_base_models_it_serves(self) -> None:
        openai_side = parse_integration_settings(byok(provider="azure")).byok
        anthropic_side = parse_integration_settings(
            byok(provider="anthropic", baseUrl=None, apiKey="sk-ant")
        ).byok

        assert openai_side is not None and anthropic_side is not None
        assert openai_side.serves(OPENAI_BASE) is True
        assert openai_side.serves(ANTHROPIC_BASE) is False
        assert anthropic_side.serves(ANTHROPIC_BASE) is True
        assert anthropic_side.serves(OPENAI_BASE) is False

    def test_gemini_and_copilot_models_are_never_served(self) -> None:
        connection = parse_integration_settings(byok()).byok

        assert connection is not None
        assert connection.serves(Llm.GEMINI_3_6_FLASH_LOW) is False
        assert connection.serves(Llm.COPILOT_GPT_5_6_SOL) is False

    @pytest.mark.parametrize("provider", ["gemini", "bedrock", "vertex"])
    def test_unsupported_providers_are_named_in_the_error(self, provider: str) -> None:
        with pytest.raises(IntegrationConfigError) as excinfo:
            parse_integration_settings(byok(provider=provider))

        message = str(excinfo.value)
        assert provider in message
        assert "openai" in message and "anthropic" in message

    def test_an_unknown_wire_api_is_refused(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(byok(wireApi="grpc"))

    def test_plain_http_endpoints_are_refused_unless_local(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(byok(baseUrl="http://api.example.com/v1"))

    def test_localhost_http_endpoints_are_allowed(self) -> None:
        settings = parse_integration_settings(
            byok(provider="openai", baseUrl="http://localhost:1234/v1", apiKey=None)
        )

        connection = settings.byok
        assert connection is not None
        assert connection.base_url == "http://localhost:1234/v1"
        assert connection.is_usable, "a local endpoint may run without a key"

    def test_urls_may_not_carry_credentials(self) -> None:
        with pytest.raises(IntegrationConfigError) as excinfo:
            parse_integration_settings(
                byok(baseUrl="https://user:pass@res.openai.azure.com")
            )

        assert "password" in str(excinfo.value)

    def test_azure_api_version_only_applies_to_azure(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(
                byok(
                    provider="openai",
                    baseUrl=None,
                    apiKey="sk-1",
                    azureApiVersion="2026-01-01",
                )
            )

    def test_an_enabled_block_needs_a_provider(self) -> None:
        with pytest.raises(IntegrationConfigError) as excinfo:
            parse_integration_settings({"copilotSdkByok": {"enabled": True}})

        assert "provider" in str(excinfo.value)


class TestIncompleteConnection:
    """An incomplete extra must never take a generation down with it."""

    def test_azure_without_an_endpoint_is_unusable_not_fatal(self) -> None:
        settings = parse_integration_settings(byok(baseUrl=None))

        connection = settings.byok
        assert connection is not None
        assert connection.is_usable is False
        assert "endpoint" in (connection.unusable_reason or "")
        assert settings.usable_byok is None
        assert any(item.code == "incomplete" for item in settings.diagnostics)

    def test_a_remote_connection_without_a_credential_is_unusable(self) -> None:
        settings = parse_integration_settings(byok(apiKey=None, bearerToken=None))

        assert settings.usable_byok is None

    def test_anthropic_without_a_credential_is_unusable(self) -> None:
        settings = parse_integration_settings(
            byok(provider="anthropic", baseUrl=None, apiKey=None)
        )

        assert settings.usable_byok is None

    def test_a_switched_off_connection_is_reported_not_used(self) -> None:
        settings = parse_integration_settings(byok(enabled=False))

        assert settings.byok_enabled is False
        assert settings.usable_byok is None
        assert any(item.code == "disabled" for item in settings.diagnostics)

    def test_a_switched_off_connection_does_not_validate_stale_fields(self) -> None:
        settings = parse_integration_settings(
            byok(enabled=False, baseUrl="unfinished-host/v1", wireApi="old-value")
        )

        assert settings.byok is None
        assert settings.usable_byok is None
        assert any(item.code == "disabled" for item in settings.diagnostics)

    def test_gemini_limitation_is_surfaced_as_a_diagnostic(self) -> None:
        settings = parse_integration_settings(byok())

        notes = [item for item in settings.diagnostics if item.target == "gemini"]
        assert notes, "Gemini's exclusion from BYOK must be explained"
        assert "Gemini" in notes[0].message

    def test_an_empty_block_configures_nothing(self) -> None:
        settings = parse_integration_settings({"copilotSdkByok": {}})

        assert settings.byok is None
        assert settings.byok_enabled is False


class TestIdentityResolution:
    def test_an_identity_resolves_to_the_connection(self) -> None:
        settings = parse_integration_settings(byok())

        connection = settings.byok_for(byok_selection_id("azure", OPENAI_BASE))

        assert connection is not None
        assert connection.api_key == "azure-secret"

    def test_a_direct_model_id_never_resolves_to_a_connection(self) -> None:
        settings = parse_integration_settings(byok())

        assert settings.byok_for(OPENAI_BASE.value) is None

    def test_an_identity_for_another_provider_does_not_resolve(self) -> None:
        settings = parse_integration_settings(byok())

        assert settings.byok_for(byok_selection_id("openai", OPENAI_BASE)) is None

    def test_an_identity_the_connection_cannot_serve_does_not_resolve(self) -> None:
        settings = parse_integration_settings(byok())

        assert settings.byok_for(byok_selection_id("azure", ANTHROPIC_BASE)) is None

    def test_an_unusable_connection_resolves_nothing(self) -> None:
        settings = parse_integration_settings(byok(apiKey=None))

        assert settings.byok_for(byok_selection_id("azure", OPENAI_BASE)) is None


class TestRedaction:
    def test_metadata_never_contains_a_secret(self) -> None:
        settings = parse_integration_settings(byok(apiKey="azure-supersecret"))

        rendered = repr(settings.safe_metadata())

        assert "azure-supersecret" not in rendered
        assert "res.openai.azure.com" in rendered
        assert "hasApiKey" in rendered

    def test_a_bearer_token_is_reported_by_presence_only(self) -> None:
        settings = parse_integration_settings(
            byok(apiKey=None, bearerToken="bearer-supersecret")
        )

        summary = settings.byok_summary
        assert summary is not None
        assert summary.has_bearer_token is True
        assert "bearer-supersecret" not in repr(summary)

    def test_redact_mapping_masks_credential_shaped_keys(self) -> None:
        redacted = redact_mapping(
            {
                "query": "hello",
                "api_key": "sk-1",
                "Authorization": "Bearer x",
                "session_cookie": "abc",
                "PASSWORD": "hunter2",
            }
        )

        assert redacted["query"] == "hello"
        for key in ("api_key", "Authorization", "session_cookie", "PASSWORD"):
            assert redacted[key] == "[redacted]"


class TestDirectProvidersAreUntouched:
    def test_parsing_byok_never_reads_direct_provider_fields(self) -> None:
        settings = parse_integration_settings(
            {
                "openAiApiKey": "sk-direct-openai",
                "anthropicApiKey": "sk-direct-anthropic",
                "geminiApiKey": "sk-direct-gemini",
                "replicateApiKey": "sk-direct-replicate",
                **byok(),
            }
        )

        connection = settings.byok
        assert connection is not None
        assert connection.api_key == "azure-secret"
        rendered = repr(settings.safe_metadata())
        for secret in (
            "sk-direct-openai",
            "sk-direct-anthropic",
            "sk-direct-gemini",
            "sk-direct-replicate",
        ):
            assert secret not in rendered

    def test_a_connection_without_its_own_key_stays_unusable(self) -> None:
        """No direct key can complete it - that is the additive guarantee."""
        settings = parse_integration_settings(
            {
                "openAiApiKey": "sk-direct-openai",
                **byok(provider="openai", baseUrl="https://api.example.com/v1",
                       apiKey=None),
            }
        )

        assert settings.usable_byok is None


class TestMcpValidation:
    def test_parses_a_stdio_server_and_normalizes_its_name(self) -> None:
        settings = parse_integration_settings(
            {"mcpServers": [stdio_server(name="My Docs Server!")]}
        )

        server = settings.mcp_servers[0]
        assert server.key == "my-docs-server"
        assert server.transport == "stdio"
        assert server.command == "npx"
        assert server.args == ("-y", "@example/docs-mcp")

    def test_stdio_needs_a_command(self) -> None:
        with pytest.raises(IntegrationConfigError) as excinfo:
            parse_integration_settings({"mcpServers": [stdio_server(command="")]})

        assert "command" in str(excinfo.value)

    def test_stdio_may_not_also_declare_a_url(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(
                {"mcpServers": [stdio_server(url="https://example.com")]}
            )

    def test_remote_servers_need_https_unless_local(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(
                {"mcpServers": [http_server(url="http://mcp.example.com")]}
            )

        settings = parse_integration_settings(
            {"mcpServers": [http_server(url="http://localhost:9000/mcp")]}
        )
        assert settings.mcp_servers[0].url == "http://localhost:9000/mcp"

    def test_remote_urls_may_not_carry_credentials(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(
                {
                    "mcpServers": [
                        http_server(url="https://user:secret@mcp.example.com/")
                    ]
                }
            )

    def test_remote_servers_may_not_declare_a_command(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings({"mcpServers": [http_server(command="bash")]})

    def test_server_count_is_capped(self) -> None:
        servers = [
            stdio_server(id=f"srv-{index}", name=f"Server {index}")
            for index in range(MAX_MCP_SERVERS + 1)
        ]

        with pytest.raises(IntegrationConfigError) as excinfo:
            parse_integration_settings({"mcpServers": servers})

        assert str(MAX_MCP_SERVERS) in str(excinfo.value)

    def test_colliding_names_are_rejected_rather_than_overwritten(self) -> None:
        with pytest.raises(IntegrationConfigError) as excinfo:
            parse_integration_settings(
                {
                    "mcpServers": [
                        stdio_server(id="a", name="Docs Server"),
                        stdio_server(id="b", name="docs  server"),
                    ]
                }
            )

        assert "distinct names" in str(excinfo.value)

    def test_argument_and_env_limits_are_enforced(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(
                {"mcpServers": [stdio_server(args=[f"--flag{i}" for i in range(33)])]}
            )

        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(
                {"mcpServers": [stdio_server(env={f"VAR_{i}": "1" for i in range(33)})]}
            )

    def test_env_names_must_be_environment_variable_shaped(self) -> None:
        with pytest.raises(IntegrationConfigError) as excinfo:
            parse_integration_settings(
                {"mcpServers": [stdio_server(env={"not a name": "1"})]}
            )

        assert "not a name" in str(excinfo.value)

    def test_header_names_must_be_http_tokens(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(
                {"mcpServers": [http_server(headers={"Bad Header": "x"})]}
            )

    def test_header_limit_is_enforced(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(
                {"mcpServers": [http_server(headers={f"X-H{i}": "v" for i in range(17)})]}
            )

    def test_tool_names_are_validated(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings({"mcpServers": [stdio_server(tools=["rm -rf /"])]})

        settings = parse_integration_settings(
            {"mcpServers": [stdio_server(tools=["search_docs", "*"])]}
        )
        assert settings.mcp_servers[0].tools == ("search_docs", "*")

    @pytest.mark.parametrize("timeout", [10, 900_000, "soon", True])
    def test_timeouts_are_bounded_and_numeric(self, timeout: object) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings({"mcpServers": [stdio_server(timeoutMs=timeout)]})

    def test_a_valid_timeout_is_kept(self) -> None:
        settings = parse_integration_settings(
            {"mcpServers": [stdio_server(timeoutMs=30_000)]}
        )

        assert settings.mcp_servers[0].timeout_ms == 30_000

    def test_control_characters_are_refused(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(
                {"mcpServers": [stdio_server(command="node\n--eval")]}
            )

    def test_a_server_needs_a_transport(self) -> None:
        with pytest.raises(IntegrationConfigError) as excinfo:
            parse_integration_settings({"mcpServers": [stdio_server(transport="")]})

        assert "transport" in str(excinfo.value)

    def test_unknown_transports_are_refused(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings(
                {"mcpServers": [stdio_server(transport="websocket")]}
            )

    def test_mcp_servers_must_be_a_list(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings({"mcpServers": {"id": "a"}})


class TestMcpActivation:
    def test_disabled_and_untrusted_servers_are_excluded_with_reasons(self) -> None:
        settings = parse_integration_settings(
            {
                "mcpServers": [
                    stdio_server(id="on", name="Trusted"),
                    stdio_server(id="off", name="Switched Off", enabled=False),
                    stdio_server(id="wild", name="Untrusted", trusted=False),
                ]
            }
        )

        assert [server.key for server in settings.active_mcp_servers] == ["trusted"]
        codes = {item.code: item.target for item in settings.diagnostics}
        assert codes["disabled"] == "switched-off"
        assert codes["untrusted"] == "untrusted"

    @pytest.mark.parametrize(
        ("enabled", "trusted"),
        [(False, False), (True, False)],
    )
    def test_an_inactive_incomplete_server_never_blocks_generation(
        self, enabled: bool, trusted: bool
    ) -> None:
        settings = parse_integration_settings(
            {
                "mcpServers": [
                    {
                        "id": "draft",
                        "name": "",
                        "enabled": enabled,
                        "trusted": trusted,
                        "transport": "stdio",
                        "command": None,
                    }
                ]
            }
        )

        assert settings.mcp_servers == ()
        assert settings.active_mcp_servers == ()
        assert any(item.code == "incomplete" for item in settings.diagnostics)

    def test_server_metadata_hides_env_and_header_values(self) -> None:
        settings = parse_integration_settings(
            {
                "mcpServers": [
                    stdio_server(env={"API_TOKEN": "tok-secret"}),
                    http_server(headers={"Authorization": "Bearer secret"}),
                ]
            }
        )

        rendered = repr(settings.safe_metadata())

        assert "tok-secret" not in rendered
        assert "Bearer secret" not in rendered
        assert "API_TOKEN" in rendered
        assert "Authorization" in rendered

    def test_write_tools_are_opt_in(self) -> None:
        settings = parse_integration_settings(
            {
                "mcpServers": [
                    stdio_server(id="ro", name="Reader"),
                    stdio_server(id="rw", name="Writer", allowWriteTools=True),
                ]
            }
        )

        by_key = {server.key: server for server in settings.mcp_servers}
        assert by_key["reader"].allow_write_tools is False
        assert by_key["writer"].allow_write_tools is True


class TestEmptyConfiguration:
    def test_no_integration_fields_means_no_integrations(self) -> None:
        settings = parse_integration_settings({"inputMode": "image"})

        assert settings.byok is None
        assert settings.byok_enabled is False
        assert settings.mcp_servers == ()
        assert settings.active_mcp_servers == ()
        assert settings.diagnostics == ()

    def test_a_non_object_payload_is_refused(self) -> None:
        with pytest.raises(IntegrationConfigError):
            parse_integration_settings("copilotSdkByok=1")
