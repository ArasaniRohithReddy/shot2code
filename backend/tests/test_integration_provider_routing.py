"""Two runtimes, side by side, chosen per selection.

A native spec always uses the native provider - even with BYOK enabled and
usable. A BYOK spec uses the SDK with the connection's own credential. Nothing
about the direct providers changes when BYOK is configured.
"""

from typing import Any, cast

import pytest

import copilot
from agent.providers.anthropic import AnthropicProviderSession
from agent.providers.factory import (
    MissingProviderCredentialError,
    create_provider_session,
)
from agent.providers.gemini import GeminiProviderSession
from agent.providers.github_copilot import CopilotProviderSession
from agent.providers.openai import OpenAIProviderSession
from integrations.config import (
    ByokConnection,
    IntegrationConfigError,
    byok_selection_id,
    parse_integration_settings,
)
from llm import Llm

PROMPT: list[dict[str, Any]] = [
    {"role": "system", "content": "You are a test."},
    {"role": "user", "content": "Build a page."},
]

OPENAI_BASE = Llm.GPT_5_6_SOL_HIGH
ANTHROPIC_BASE = Llm.CLAUDE_OPUS_5_MAX


def byok_block(**overrides: object) -> dict[str, object]:
    block: dict[str, object] = {
        "enabled": True,
        "provider": "openai",
        "baseUrl": "https://api.example.com/v1",
        "apiKey": "sk-byok",
    }
    block.update(overrides)
    return block


def settings_for(
    byok: dict[str, object] | None = None,
    servers: list[dict[str, object]] | None = None,
):
    payload: dict[str, object] = {}
    if byok is not None:
        payload["copilotSdkByok"] = byok
    if servers is not None:
        payload["mcpServers"] = servers
    return parse_integration_settings(payload)


def trusted_server(**fields: object) -> dict[str, object]:
    server: dict[str, object] = {
        "id": "docs",
        "name": "Docs",
        "enabled": True,
        "trusted": True,
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "docs-mcp"],
    }
    server.update(fields)
    return server


def session_for(model: Llm, **overrides: object):
    kwargs: dict[str, object] = {
        "model": model,
        "prompt_messages": PROMPT,
        "should_generate_images": False,
        "openai_api_key": None,
        "openai_base_url": None,
        "anthropic_api_key": None,
        "gemini_api_key": None,
        "replicate_api_key": None,
    }
    kwargs.update(overrides)
    return create_provider_session(**kwargs)  # pyright: ignore[reportArgumentType]


def connection_of(settings: Any) -> ByokConnection:
    connection = settings.usable_byok
    assert connection is not None
    return connection


class TestNativeSelectionsAreNeverRerouted:
    @pytest.mark.parametrize(
        ("model", "credential", "expected"),
        [
            (Llm.GPT_5_6_SOL_HIGH, "openai_api_key", OpenAIProviderSession),
            (Llm.CLAUDE_OPUS_5_MAX, "anthropic_api_key", AnthropicProviderSession),
            (Llm.GEMINI_3_6_FLASH_LOW, "gemini_api_key", GeminiProviderSession),
        ],
    )
    def test_a_native_run_keeps_its_own_client_with_byok_usable(
        self, model: Llm, credential: str, expected: type
    ) -> None:
        settings = settings_for(
            byok=byok_block(provider="openai"), servers=[trusted_server()]
        )
        assert settings.usable_byok is not None, "BYOK is usable in this test"

        # No byok_connection argument: this is a native spec.
        session = session_for(model, **{credential: "key"}, integrations=settings)

        assert isinstance(session, expected)

    def test_an_anthropic_byok_connection_leaves_claude_native(self) -> None:
        settings = settings_for(
            byok=byok_block(provider="anthropic", baseUrl=None, apiKey="sk-ant-byok")
        )

        session = session_for(
            ANTHROPIC_BASE, anthropic_api_key="sk-direct", integrations=settings
        )

        assert isinstance(session, AnthropicProviderSession)

    def test_byok_never_substitutes_for_a_missing_direct_key(self) -> None:
        """BYOK is additive: it never satisfies a native selection's credential."""
        settings = settings_for(byok=byok_block())

        with pytest.raises(MissingProviderCredentialError):
            session_for(OPENAI_BASE, integrations=settings)

    def test_native_sessions_never_receive_mcp_servers(self) -> None:
        settings = settings_for(servers=[trusted_server()])

        session = session_for(
            OPENAI_BASE, openai_api_key="sk-1", integrations=settings
        )

        assert isinstance(session, OpenAIProviderSession)
        assert not hasattr(session, "_mcp_servers")


class TestByokSelectionRouting:
    def byok_session(self, model: Llm = OPENAI_BASE, **kwargs: object):
        settings = settings_for(**kwargs)  # pyright: ignore[reportArgumentType]
        session = session_for(
            model,
            integrations=settings,
            byok_connection=connection_of(settings),
        )
        assert isinstance(session, CopilotProviderSession)
        return session

    def test_a_byok_spec_runs_on_the_sdk(self) -> None:
        session = self.byok_session(byok=byok_block())

        config = cast(dict[str, Any], session._provider_config)  # pyright: ignore[reportPrivateUsage]
        assert config["type"] == "openai"
        assert config["api_key"] == "sk-byok"

    def test_an_anthropic_byok_spec_runs_on_the_sdk(self) -> None:
        session = self.byok_session(
            model=ANTHROPIC_BASE,
            byok=byok_block(provider="anthropic", baseUrl=None, apiKey="sk-ant-byok"),
        )

        config = cast(dict[str, Any], session._provider_config)  # pyright: ignore[reportPrivateUsage]
        assert config["type"] == "anthropic"
        assert config["model_id"] == "claude-opus-5"

    def test_the_client_runs_in_empty_mode_with_an_explicit_base_directory(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: object
    ) -> None:
        monkeypatch.setenv("SHOT2CODE_APP_DATA_DIR", str(tmp_path))

        session = self.byok_session(byok=byok_block())
        options = session._client._options  # pyright: ignore[reportPrivateUsage]

        assert options.mode == "empty"
        assert options.use_logged_in_user is False
        assert options.base_directory is not None
        assert str(tmp_path) in options.base_directory

    def test_the_model_on_the_wire_is_the_base_models_provider_name(self) -> None:
        session = self.byok_session(byok=byok_block())

        assert session._model_api_name == "gpt-5.6-sol"  # pyright: ignore[reportPrivateUsage]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("model", "expected_effort"),
        [
            (Llm.GPT_5_6_SOL_HIGH, "high"),
            (Llm.GPT_5_6_SOL_NONE, None),
            (Llm.CLAUDE_OPUS_5_MAX, "max"),
        ],
    )
    async def test_byok_preserves_the_selected_models_reasoning_effort(
        self,
        monkeypatch: pytest.MonkeyPatch,
        model: Llm,
        expected_effort: str | None,
    ) -> None:
        byok_settings = (
            byok_block(provider="anthropic", baseUrl=None, apiKey="sk-ant-byok")
            if model == Llm.CLAUDE_OPUS_5_MAX
            else byok_block()
        )
        session = self.byok_session(model=model, byok=byok_settings)
        captured: dict[str, Any] = {}

        async def fake_start() -> None:
            return None

        async def fake_create_session(**kwargs: Any) -> object:
            captured.update(kwargs)
            return object()

        monkeypatch.setattr(session._client, "start", fake_start)  # pyright: ignore[reportPrivateUsage]
        monkeypatch.setattr(
            session._client, "create_session", fake_create_session  # pyright: ignore[reportPrivateUsage]
        )

        await session._ensure_session()  # pyright: ignore[reportPrivateUsage]

        if expected_effort is None:
            assert "reasoning_effort" not in captured
        else:
            assert captured["reasoning_effort"] == expected_effort

    def test_a_deployment_name_overrides_only_the_wire_model(self) -> None:
        session = self.byok_session(byok=byok_block(wireModel="my-deployment"))

        config = cast(dict[str, Any], session._provider_config)  # pyright: ignore[reportPrivateUsage]
        assert config["model_id"] == "gpt-5.6-sol"
        assert config["wire_model"] == "my-deployment"

    def test_direct_keys_in_the_request_never_reach_the_provider_config(self) -> None:
        settings = settings_for(byok=byok_block(apiKey="sk-byok-only"))

        session = session_for(
            OPENAI_BASE,
            openai_api_key="sk-direct-must-not-leak",
            anthropic_api_key="sk-ant-direct",
            integrations=settings,
            byok_connection=connection_of(settings),
        )

        assert isinstance(session, CopilotProviderSession)
        config = cast(dict[str, Any], session._provider_config)  # pyright: ignore[reportPrivateUsage]
        assert config["api_key"] == "sk-byok-only"
        assert "sk-direct-must-not-leak" not in repr(config)
        assert "sk-ant-direct" not in repr(config)

    def test_a_gemini_model_can_never_be_run_on_byok(self) -> None:
        settings = settings_for(byok=byok_block())

        with pytest.raises(IntegrationConfigError):
            session_for(
                Llm.GEMINI_3_6_FLASH_LOW,
                integrations=settings,
                byok_connection=connection_of(settings),
            )

    def test_a_model_the_connection_cannot_serve_is_refused(self) -> None:
        settings = settings_for(byok=byok_block(provider="openai"))

        with pytest.raises(IntegrationConfigError):
            session_for(
                ANTHROPIC_BASE,
                integrations=settings,
                byok_connection=connection_of(settings),
            )


class TestBothRuntimesInOneRun:
    def test_the_same_base_model_runs_natively_and_on_byok(self) -> None:
        settings = settings_for(byok=byok_block(provider="azure",
                                                baseUrl="https://r.openai.azure.com",
                                                apiKey="azure-secret"))

        native = session_for(
            OPENAI_BASE, openai_api_key="sk-direct", integrations=settings
        )
        byok = session_for(
            OPENAI_BASE,
            openai_api_key="sk-direct",
            integrations=settings,
            byok_connection=connection_of(settings),
        )

        assert isinstance(native, OpenAIProviderSession)
        assert isinstance(byok, CopilotProviderSession)
        # Two different identities for one base model.
        assert byok_selection_id("azure", OPENAI_BASE) != OPENAI_BASE.value


class TestMcpSessionConfiguration:
    def copilot_session(
        self, servers: list[dict[str, object]]
    ) -> CopilotProviderSession:
        session = session_for(
            Llm.COPILOT_GPT_5_6_SOL,
            copilot_github_token="github_pat_test",
            integrations=settings_for(servers=servers),
        )
        assert isinstance(session, CopilotProviderSession)
        return session

    def test_subscription_sessions_receive_trusted_servers(self) -> None:
        session = self.copilot_session([trusted_server()])

        assert list(session._mcp_servers) == ["docs"]  # pyright: ignore[reportPrivateUsage]
        assert session._permission_handler is not None  # pyright: ignore[reportPrivateUsage]

    def test_byok_sessions_receive_trusted_servers_too(self) -> None:
        settings = settings_for(byok=byok_block(), servers=[trusted_server()])

        session = session_for(
            OPENAI_BASE,
            integrations=settings,
            byok_connection=connection_of(settings),
        )

        assert isinstance(session, CopilotProviderSession)
        assert list(session._mcp_servers) == ["docs"]  # pyright: ignore[reportPrivateUsage]

    def test_untrusted_and_disabled_servers_never_reach_the_sdk(self) -> None:
        session = self.copilot_session(
            [
                trusted_server(id="ok", name="Docs"),
                trusted_server(id="off", name="Off", enabled=False),
                trusted_server(id="wild", name="Wild", trusted=False),
            ]
        )

        assert list(session._mcp_servers) == ["docs"]  # pyright: ignore[reportPrivateUsage]

    def test_tool_allowlist_covers_custom_and_mcp_but_no_builtins(self) -> None:
        session = self.copilot_session([trusted_server()])

        entries = session._available_tools().to_list()  # pyright: ignore[reportPrivateUsage]

        assert entries == ["custom:*", "mcp:*"]
        assert not any(entry.startswith("builtin:") for entry in entries)

    def test_without_mcp_servers_only_custom_tools_are_allowed(self) -> None:
        session = self.copilot_session([])

        assert session._available_tools().to_list() == ["custom:*"]  # pyright: ignore[reportPrivateUsage]
        assert session._permission_handler is None  # pyright: ignore[reportPrivateUsage]

    @pytest.mark.asyncio
    async def test_session_kwargs_pin_mcp_storage_and_permissions(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The SDK call itself must carry in-memory OAuth storage and our handler."""
        session = self.copilot_session([trusted_server()])
        captured: dict[str, Any] = {}

        async def fake_start() -> None:
            return None

        async def fake_create_session(**kwargs: Any) -> object:
            captured.update(kwargs)
            return object()

        monkeypatch.setattr(session._client, "start", fake_start)  # pyright: ignore[reportPrivateUsage]
        monkeypatch.setattr(
            session._client, "create_session", fake_create_session  # pyright: ignore[reportPrivateUsage]
        )

        await session._ensure_session()  # pyright: ignore[reportPrivateUsage]

        assert captured["mcp_oauth_token_storage"] == "in-memory"
        assert captured["mcp_servers"]["docs"]["command"] == "npx"
        assert callable(captured["on_permission_request"])
        assert isinstance(captured["available_tools"], copilot.ToolSet)
        assert captured["available_tools"].to_list() == ["custom:*", "mcp:*"]
        assert captured["enable_config_discovery"] is False
        # Subscription sessions must not carry a BYOK provider block.
        assert "provider" not in captured
