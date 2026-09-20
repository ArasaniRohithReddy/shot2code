"""Live provider validation: minimal requests, classified answers, no leaks.

Each provider is probed through a stubbed client so the suite never spends a
cent or touches the network. What is pinned here is the contract around that
call: which credential is used, which model, how failures are categorised, and
that a BYOK check keeps its synthetic identity and closes what it opens.
"""

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import provider_validation
from integrations.config import byok_selection_id
from llm import Llm
from provider_validation import (
    DEFAULT_VALIDATION_MODELS,
    ProviderValidationRequest,
    resolve_credential,
    resolve_model,
    validate_provider,
)
from routes import providers as providers_route

OPENAI_BASE = Llm.GPT_5_6_SOL_HIGH
ANTHROPIC_BASE = Llm.CLAUDE_OPUS_5_MAX


def byok_block(**overrides: object) -> dict[str, object]:
    block: dict[str, object] = {
        "enabled": True,
        "provider": "azure",
        "baseUrl": "https://res.openai.azure.com",
        "apiKey": "azure-secret",
    }
    block.update(overrides)
    return block


class StubOpenAI:
    """Records what the validator asked for; answers or raises on demand."""

    last_call: dict[str, Any] = {}
    error: Exception | None = None

    def __init__(self, **kwargs: Any) -> None:
        StubOpenAI.last_call = {"init": kwargs}
        self.chat = self
        self.completions = self
        self.closed = False

    async def create(self, **kwargs: Any) -> object:
        StubOpenAI.last_call["create"] = kwargs
        if StubOpenAI.error is not None:
            raise StubOpenAI.error
        return object()

    async def close(self) -> None:
        self.closed = True


@pytest.fixture(autouse=True)
def clear_environment(monkeypatch: pytest.MonkeyPatch):
    for name in (
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "REPLICATE_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)
    StubOpenAI.error = None
    StubOpenAI.last_call = {}


def install_openai_stub(monkeypatch: pytest.MonkeyPatch) -> None:
    import openai

    monkeypatch.setattr(openai, "AsyncOpenAI", StubOpenAI)


class TestCredentialPrecedence:
    def test_the_request_credential_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("OPENAI_API_KEY", "sk-from-env")

        assert resolve_credential("openai", "sk-from-request") == "sk-from-request"

    def test_the_backend_credential_is_the_fallback(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-from-env")

        assert resolve_credential("anthropic", None) == "sk-from-env"
        assert resolve_credential("anthropic", "   ") == "sk-from-env"

    def test_no_credential_anywhere_is_none(self) -> None:
        assert resolve_credential("gemini", None) is None

    @pytest.mark.asyncio
    async def test_a_missing_credential_is_a_configuration_problem(self) -> None:
        result = await validate_provider(
            ProviderValidationRequest(provider="openai")
        )

        assert result.ok is False
        assert result.category == "configuration"
        assert "OpenAI API key" in result.message

    @pytest.mark.asyncio
    async def test_the_request_key_is_the_one_sent(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_openai_stub(monkeypatch)
        monkeypatch.setenv("OPENAI_API_KEY", "sk-from-env")

        await validate_provider(
            ProviderValidationRequest(provider="openai", api_key="sk-from-request")
        )

        assert StubOpenAI.last_call["init"]["api_key"] == "sk-from-request"


class TestModelResolution:
    def test_a_default_model_is_used_when_none_is_named(self) -> None:
        model, problem = resolve_model("openai", None)

        assert problem is None
        assert model is DEFAULT_VALIDATION_MODELS["openai"]

    def test_a_named_model_is_honoured(self) -> None:
        model, problem = resolve_model("anthropic", ANTHROPIC_BASE.value)

        assert problem is None
        assert model is ANTHROPIC_BASE

    def test_an_unknown_model_is_reported(self) -> None:
        model, problem = resolve_model("openai", "gpt-9000")

        assert model is None
        assert problem is not None
        assert problem.category == "model"
        assert "gpt-9000" in problem.message

    def test_a_model_from_another_provider_is_reported(self) -> None:
        model, problem = resolve_model("openai", ANTHROPIC_BASE.value)

        assert model is None
        assert problem is not None
        assert problem.category == "model"
        assert "Anthropic" in problem.message

    def test_every_default_is_a_model_of_its_own_provider(self) -> None:
        from llm import provider_for_model

        for provider, model in DEFAULT_VALIDATION_MODELS.items():
            assert provider_for_model(model) == provider


class TestSuccessAndClassification:
    @pytest.mark.asyncio
    async def test_a_working_key_is_ready(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_openai_stub(monkeypatch)

        result = await validate_provider(
            ProviderValidationRequest(provider="openai", api_key="sk-live")
        )

        assert result.ok is True
        assert result.category == "ready"
        assert result.model_id == DEFAULT_VALIDATION_MODELS["openai"].value

    @pytest.mark.asyncio
    async def test_the_test_request_is_minimal(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_openai_stub(monkeypatch)

        await validate_provider(
            ProviderValidationRequest(provider="openai", api_key="sk-live")
        )

        create = StubOpenAI.last_call["create"]
        assert create["messages"] == [{"role": "user", "content": "ping"}]
        assert create["max_completion_tokens"] <= 16

    @pytest.mark.asyncio
    async def test_no_credits_is_reported_as_billing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_openai_stub(monkeypatch)
        StubOpenAI.error = Exception(
            "You have no credits remaining. Please add credits."
        )

        result = await validate_provider(
            ProviderValidationRequest(provider="openai", api_key="sk-live")
        )

        assert result.ok is False
        assert result.category == "billing"

    @pytest.mark.asyncio
    async def test_a_bad_key_is_reported_as_credentials(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_openai_stub(monkeypatch)
        StubOpenAI.error = Exception("Incorrect API key provided: sk-live-secret123456")

        result = await validate_provider(
            ProviderValidationRequest(provider="openai", api_key="sk-live-secret123456")
        )

        assert result.category == "credentials"
        assert "sk-live-secret123456" not in result.message

    @pytest.mark.asyncio
    async def test_a_transport_failure_is_reported_as_network(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_openai_stub(monkeypatch)
        StubOpenAI.error = Exception("Connection error")

        result = await validate_provider(
            ProviderValidationRequest(provider="openai", api_key="sk-live")
        )

        assert result.category == "network"

    @pytest.mark.asyncio
    async def test_a_validator_bug_still_returns_a_safe_answer(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def explode(_request: ProviderValidationRequest) -> None:
            raise RuntimeError("boom")

        monkeypatch.setitem(provider_validation._VALIDATORS, "openai", explode)  # pyright: ignore[reportPrivateUsage]

        result = await validate_provider(
            ProviderValidationRequest(provider="openai", api_key="sk-live")
        )

        assert result.ok is False
        assert result.provider == "openai"


class TestReplicate:
    @pytest.mark.asyncio
    async def test_replicate_needs_a_backend_key(self) -> None:
        result = await validate_provider(
            ProviderValidationRequest(provider="replicate")
        )

        assert result.category == "configuration"
        assert "REPLICATE_API_KEY" in result.message

    @pytest.mark.asyncio
    async def test_replicate_uses_its_account_endpoint(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import httpx

        captured: dict[str, Any] = {}

        class StubResponse:
            status_code = 200

            def raise_for_status(self) -> None:
                return None

        class StubClient:
            def __init__(self, **kwargs: Any) -> None:
                captured["init"] = kwargs

            async def __aenter__(self) -> "StubClient":
                return self

            async def __aexit__(self, *_args: object) -> None:
                return None

            async def get(self, url: str, headers: dict[str, str]) -> StubResponse:
                captured["url"] = url
                captured["headers"] = headers
                return StubResponse()

        monkeypatch.setattr(httpx, "AsyncClient", StubClient)

        result = await validate_provider(
            ProviderValidationRequest(provider="replicate", api_key="r8_live")
        )

        assert result.ok is True
        assert captured["url"] == provider_validation.REPLICATE_ACCOUNT_URL
        assert captured["headers"]["Authorization"] == "Bearer r8_live"
        assert captured["init"]["timeout"] > 0


class TestByok:
    @pytest.mark.asyncio
    async def test_a_missing_connection_is_a_configuration_problem(self) -> None:
        result = await validate_provider(
            ProviderValidationRequest(provider="copilot-byok")
        )

        assert result.ok is False
        assert result.category == "configuration"

    @pytest.mark.asyncio
    async def test_an_incomplete_connection_says_what_is_missing(self) -> None:
        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok",
                copilot_sdk_byok=byok_block(apiKey=None),
            )
        )

        assert result.category == "configuration"
        assert "API key" in result.message

    @pytest.mark.asyncio
    async def test_an_invalid_block_is_explained_not_raised(self) -> None:
        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok",
                copilot_sdk_byok=byok_block(provider="bedrock"),
            )
        )

        assert result.ok is False
        assert result.category == "configuration"
        assert "bedrock" in result.message

    def test_a_synthetic_identity_resolves_to_its_base_model(self) -> None:
        from integrations.config import parse_integration_settings

        settings = parse_integration_settings({"copilotSdkByok": byok_block()})
        assert settings.byok is not None

        selection, problem = provider_validation._byok_model(  # pyright: ignore[reportPrivateUsage]
            settings.byok, byok_selection_id("azure", OPENAI_BASE)
        )

        assert problem is None
        assert selection is not None
        assert selection.base_model is OPENAI_BASE

    def test_a_bare_base_model_id_also_resolves(self) -> None:
        from integrations.config import parse_integration_settings

        settings = parse_integration_settings({"copilotSdkByok": byok_block()})
        assert settings.byok is not None

        selection, problem = provider_validation._byok_model(  # pyright: ignore[reportPrivateUsage]
            settings.byok, OPENAI_BASE.value
        )

        assert problem is None
        assert selection is not None
        assert selection.base_model is OPENAI_BASE

    def test_an_identity_for_another_provider_is_refused(self) -> None:
        from integrations.config import parse_integration_settings

        settings = parse_integration_settings({"copilotSdkByok": byok_block()})
        assert settings.byok is not None

        selection, problem = provider_validation._byok_model(  # pyright: ignore[reportPrivateUsage]
            settings.byok, byok_selection_id("openai", OPENAI_BASE)
        )

        assert selection is None
        assert problem is not None
        assert problem.category == "configuration"

    def test_a_model_the_connection_cannot_serve_is_refused(self) -> None:
        from integrations.config import parse_integration_settings

        settings = parse_integration_settings({"copilotSdkByok": byok_block()})
        assert settings.byok is not None

        selection, problem = provider_validation._byok_model(  # pyright: ignore[reportPrivateUsage]
            settings.byok, ANTHROPIC_BASE.value
        )

        assert selection is None
        assert problem is not None

    @pytest.mark.asyncio
    async def test_a_byok_result_reports_the_synthetic_identity(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The answer must name the BYOK run identity, not the base model."""
        import copilot

        default_base = DEFAULT_VALIDATION_MODELS["openai"]
        closed: dict[str, bool] = {"session": False, "client": False}
        captured: dict[str, Any] = {}

        class StubSession:
            async def send_and_wait(self, prompt: str, timeout: float) -> object:
                captured["prompt"] = prompt
                return object()

            async def disconnect(self) -> None:
                closed["session"] = True

        class StubClient:
            def __init__(self, **kwargs: Any) -> None:
                captured["client"] = kwargs

            async def start(self) -> None:
                return None

            async def create_session(self, **kwargs: Any) -> StubSession:
                captured["session"] = kwargs
                return StubSession()

            async def stop(self) -> None:
                closed["client"] = True

        monkeypatch.setattr(copilot, "CopilotClient", StubClient)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok", copilot_sdk_byok=byok_block()
            )
        )

        assert result.ok is True
        assert result.model_id == byok_selection_id("azure", default_base)
        assert result.model_id is not None
        assert result.model_id.startswith("sdk-byok/")
        # Empty mode, no built-in tools, session and client both closed.
        assert captured["client"]["mode"] == "empty"
        assert captured["client"]["use_logged_in_user"] is False
        assert captured["session"]["available_tools"].to_list() == ["custom:*"]
        assert captured["session"]["provider"]["type"] == "azure"
        assert closed == {"session": True, "client": True}

    @pytest.mark.asyncio
    async def test_a_byok_failure_is_classified_and_cleans_up(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import copilot

        closed: dict[str, bool] = {"client": False}

        class StubClient:
            def __init__(self, **kwargs: Any) -> None:
                return None

            async def start(self) -> None:
                raise Exception("Incorrect API key provided: azure-secret")

            async def stop(self) -> None:
                closed["client"] = True

        monkeypatch.setattr(copilot, "CopilotClient", StubClient)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok", copilot_sdk_byok=byok_block()
            )
        )

        assert result.ok is False
        assert result.category == "credentials"
        assert "azure-secret" not in result.message
        assert closed["client"] is True


class TestValidationRoute:
    def client(self) -> TestClient:
        app = FastAPI()
        app.include_router(providers_route.router)
        return TestClient(app)

    def test_the_response_shape_is_the_documented_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_openai_stub(monkeypatch)

        response = self.client().post(
            "/api/providers/validate",
            json={"provider": "openai", "apiKey": "sk-live-secret-value"},
        )

        assert response.status_code == 200
        body = response.json()
        assert set(body) == {"provider", "ok", "category", "message", "modelId", "models"}
        assert body["provider"] == "openai"
        assert body["ok"] is True
        assert body["category"] == "ready"
        assert "sk-live-secret-value" not in response.text

    def test_an_unsupported_provider_is_rejected_by_the_schema(self) -> None:
        response = self.client().post(
            "/api/providers/validate", json={"provider": "cohere"}
        )

        assert response.status_code == 422

    def test_an_error_is_reported_with_its_category(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_openai_stub(monkeypatch)
        StubOpenAI.error = Exception("You have no credits remaining.")

        response = self.client().post(
            "/api/providers/validate",
            json={"provider": "openai", "apiKey": "sk-live"},
        )

        body = response.json()
        assert body["ok"] is False
        assert body["category"] == "billing"
