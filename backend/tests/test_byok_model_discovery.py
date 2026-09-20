"""Asking an organisation endpoint what it actually serves.

Only the endpoint knows its model list, so validation asks it at ``/models``
rather than assuming a catalog. What is pinned here: the list is bounded and
sanitised, a listing failure is an actionable error rather than an invented
list, and Azure/Anthropic stay honest about not supporting listing at all.
"""

from typing import Any

import pytest

import provider_validation
from provider_errors import classify_provider_error
from provider_validation import (
    ModelListingUnsupported,
    MAX_DISCOVERED_MODELS,
    ProviderValidationRequest,
    discover_openai_compatible_models,
    validate_provider,
)

CUSTOM_MODEL = "custom-vision-model"
BASE_URL = "https://models.example.org/v1"
CUSTOM_ID = f"sdk-byok/openai/custom/{CUSTOM_MODEL}"


def custom_block(**overrides: object) -> dict[str, object]:
    block: dict[str, object] = {
        "enabled": True,
        "provider": "openai",
        "baseUrl": BASE_URL,
        "apiKey": "endpoint-secret-value",
        "wireModel": CUSTOM_MODEL,
    }
    block.update(overrides)
    return block


def install_http_stub(
    monkeypatch: pytest.MonkeyPatch,
    payload: Any = None,
    error: Exception | None = None,
    status_error: Exception | None = None,
) -> dict[str, Any]:
    import httpx

    captured: dict[str, Any] = {}

    class StubResponse:
        status_code = 200

        def raise_for_status(self) -> None:
            if status_error is not None:
                raise status_error

        def json(self) -> Any:
            return payload

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
            if error is not None:
                raise error
            return StubResponse()

    monkeypatch.setattr(httpx, "AsyncClient", StubClient)
    return captured


def install_sdk_stub(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    import copilot

    captured: dict[str, Any] = {}

    class StubSession:
        async def send_and_wait(self, prompt: str, timeout: float) -> object:
            return object()

        async def disconnect(self) -> None:
            captured["disconnected"] = True

    class StubClient:
        def __init__(self, **kwargs: Any) -> None:
            captured["client"] = kwargs

        async def start(self) -> None:
            return None

        async def create_session(self, **kwargs: Any) -> StubSession:
            captured["session"] = kwargs
            return StubSession()

        async def stop(self) -> None:
            captured["stopped"] = True

    monkeypatch.setattr(copilot, "CopilotClient", StubClient)
    return captured


class TestDiscovery:
    @pytest.mark.asyncio
    async def test_it_asks_the_endpoints_own_models_route(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        captured = install_http_stub(
            monkeypatch, payload={"data": [{"id": CUSTOM_MODEL}]}
        )

        models = await discover_openai_compatible_models(BASE_URL, "secret-key")

        assert models == (CUSTOM_MODEL,)
        assert captured["url"] == f"{BASE_URL}/models"
        assert captured["headers"]["Authorization"] == "Bearer secret-key"

    @pytest.mark.asyncio
    async def test_a_trailing_slash_does_not_double_up(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        captured = install_http_stub(monkeypatch, payload={"data": []})

        await discover_openai_compatible_models(BASE_URL + "/", "secret-key")

        assert captured["url"] == f"{BASE_URL}/models"

    @pytest.mark.asyncio
    async def test_a_bare_list_payload_is_accepted(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_http_stub(monkeypatch, payload=[{"id": "a-model"}, "b-model"])

        models = await discover_openai_compatible_models(BASE_URL, "k")

        assert models == ("a-model", "b-model")

    @pytest.mark.asyncio
    async def test_unusable_ids_are_dropped_not_reported(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_http_stub(
            monkeypatch,
            payload={
                "data": [
                    {"id": CUSTOM_MODEL},
                    {"id": "has space"},
                    {"id": ""},
                    {"id": "x" * 300},
                    {"nope": 1},
                    {"id": CUSTOM_MODEL},
                ]
            },
        )

        models = await discover_openai_compatible_models(BASE_URL, "k")

        assert models == (CUSTOM_MODEL,), "sanitised and de-duplicated"

    @pytest.mark.asyncio
    async def test_the_list_is_bounded(self, monkeypatch: pytest.MonkeyPatch) -> None:
        install_http_stub(
            monkeypatch,
            payload={"data": [{"id": f"model-{index}"} for index in range(500)]},
        )

        models = await discover_openai_compatible_models(BASE_URL, "k")

        assert len(models) == MAX_DISCOVERED_MODELS

    @pytest.mark.asyncio
    async def test_a_malformed_payload_yields_nothing_rather_than_guesses(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_http_stub(monkeypatch, payload={"unexpected": True})

        assert await discover_openai_compatible_models(BASE_URL, "k") == ()

    @pytest.mark.asyncio
    async def test_a_transport_failure_propagates(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_http_stub(monkeypatch, error=Exception("Connection refused"))

        with pytest.raises(Exception):
            await discover_openai_compatible_models(BASE_URL, "k")


class TestByokValidationWithDiscovery:
    @pytest.mark.asyncio
    async def test_a_working_endpoint_returns_its_models(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_http_stub(
            monkeypatch,
            payload={"data": [{"id": CUSTOM_MODEL}, {"id": "other-custom-model"}]},
        )
        sdk = install_sdk_stub(monkeypatch)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok", copilot_sdk_byok=custom_block()
            )
        )

        assert result.ok is True
        assert result.category == "ready"
        assert result.model_id == CUSTOM_ID
        assert result.models == (CUSTOM_MODEL, "other-custom-model")
        # The real endpoint model is what the SDK session was configured with.
        assert sdk["session"]["provider"]["wire_model"] == CUSTOM_MODEL
        assert sdk["session"]["provider"]["base_url"] == BASE_URL
        assert "reasoning_effort" not in sdk["session"]

    @pytest.mark.asyncio
    async def test_a_listing_failure_is_actionable_not_invented(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_http_stub(monkeypatch, error=Exception("Connection refused"))

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok", copilot_sdk_byok=custom_block()
            )
        )

        assert result.ok is False
        assert result.category == "network"
        assert "/models" in result.message
        assert result.models == (), "never invent a model list"

    @pytest.mark.asyncio
    async def test_a_rejected_key_during_listing_is_a_credentials_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class Unauthorized(Exception):
            status_code = 401

        install_http_stub(monkeypatch, status_error=Unauthorized("Unauthorized"))

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok", copilot_sdk_byok=custom_block()
            )
        )

        assert result.ok is False
        assert result.category == "credentials"
        assert "endpoint-secret-value" not in result.message

    @pytest.mark.asyncio
    async def test_a_wire_model_the_endpoint_does_not_list_is_reported(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_http_stub(monkeypatch, payload={"data": [{"id": "other-custom-model"}]})

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok", copilot_sdk_byok=custom_block()
            )
        )

        assert result.ok is False
        assert result.category == "model"
        assert CUSTOM_MODEL in result.message
        assert result.models == ("other-custom-model",), "offer what it does serve"

    @pytest.mark.asyncio
    async def test_anthropic_skips_listing_and_says_so(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        captured = install_http_stub(monkeypatch, payload={"data": []})
        install_sdk_stub(monkeypatch)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok",
                copilot_sdk_byok={
                    "enabled": True,
                    "provider": "anthropic",
                    "apiKey": "sk-ant-byok",
                },
            )
        )

        assert result.ok is True
        assert result.models == ()
        assert "not available" in result.message
        assert "url" not in captured, "no listing call is attempted"

    @pytest.mark.asyncio
    async def test_azure_skips_listing_and_allows_a_manual_wire_model(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        captured = install_http_stub(monkeypatch, payload={"data": []})
        sdk = install_sdk_stub(monkeypatch)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok",
                copilot_sdk_byok={
                    "enabled": True,
                    "provider": "azure",
                    "baseUrl": "https://res.openai.azure.com",
                    "apiKey": "azure-secret",
                    "wireModel": "my-deployment",
                },
            )
        )

        assert result.ok is True
        assert result.models == ()
        assert "url" not in captured
        assert sdk["session"]["provider"]["wire_model"] == "my-deployment"
        assert result.model_id == "sdk-byok/azure/custom/my-deployment"

    @pytest.mark.asyncio
    async def test_a_stale_identity_is_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_http_stub(monkeypatch, payload={"data": [{"id": "other-custom-model"}]})

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok",
                model_id=CUSTOM_ID,
                copilot_sdk_byok=custom_block(wireModel="other-custom-model"),
            )
        )

        assert result.ok is False
        assert result.category == "configuration"
        assert CUSTOM_MODEL in result.message

    @pytest.mark.asyncio
    async def test_the_endpoint_model_can_be_named_directly(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_http_stub(monkeypatch, payload={"data": [{"id": CUSTOM_MODEL}]})
        install_sdk_stub(monkeypatch)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok",
                model_id=CUSTOM_MODEL,
                copilot_sdk_byok=custom_block(),
            )
        )

        assert result.ok is True
        assert result.model_id == CUSTOM_ID

    @pytest.mark.asyncio
    async def test_the_response_never_carries_the_credential(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_http_stub(monkeypatch, payload={"data": [{"id": CUSTOM_MODEL}]})
        install_sdk_stub(monkeypatch)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok", copilot_sdk_byok=custom_block()
            )
        )

        assert "endpoint-secret-value" not in repr(result)


class TestValidationRouteModels:
    def test_the_models_list_is_serialised(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from routes import providers as providers_route

        install_http_stub(monkeypatch, payload={"data": [{"id": CUSTOM_MODEL}]})
        install_sdk_stub(monkeypatch)

        app = FastAPI()
        app.include_router(providers_route.router)
        response = TestClient(app).post(
            "/api/providers/validate",
            json={"provider": "copilot-byok", "copilotSdkByok": custom_block()},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["models"] == [CUSTOM_MODEL]
        assert body["modelId"] == CUSTOM_ID
        assert "endpoint-secret-value" not in response.text


class TestListingUnsupportedFallback:
    """``/models`` is optional, so a missing route is not a failure."""

    def install_status(
        self, monkeypatch: pytest.MonkeyPatch, status_code: int
    ) -> dict[str, Any]:
        import httpx

        captured: dict[str, Any] = {}

        class StubResponse:
            def __init__(self) -> None:
                self.status_code = status_code

            def raise_for_status(self) -> None:
                raise Exception(f"HTTP {status_code}")

            def json(self) -> Any:
                return {}

        class StubClient:
            def __init__(self, **kwargs: Any) -> None:
                return None

            async def __aenter__(self) -> "StubClient":
                return self

            async def __aexit__(self, *_args: object) -> None:
                return None

            async def get(self, url: str, headers: dict[str, str]) -> StubResponse:
                captured["url"] = url
                return StubResponse()

        monkeypatch.setattr(httpx, "AsyncClient", StubClient)
        return captured

    @pytest.mark.parametrize("status_code", [404, 405, 501])
    @pytest.mark.asyncio
    async def test_a_missing_route_raises_the_unsupported_signal(
        self, monkeypatch: pytest.MonkeyPatch, status_code: int
    ) -> None:
        self.install_status(monkeypatch, status_code)

        with pytest.raises(ModelListingUnsupported):
            await discover_openai_compatible_models(BASE_URL, "k")

    @pytest.mark.parametrize("status_code", [404, 405, 501])
    @pytest.mark.asyncio
    async def test_validation_falls_back_to_the_manual_wire_model(
        self, monkeypatch: pytest.MonkeyPatch, status_code: int
    ) -> None:
        self.install_status(monkeypatch, status_code)
        sdk = install_sdk_stub(monkeypatch)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok", copilot_sdk_byok=custom_block()
            )
        )

        assert result.ok is True, "a missing listing route is not a failure"
        assert result.models == ()
        assert "set the wire model by hand" in result.message
        assert sdk["session"]["provider"]["wire_model"] == CUSTOM_MODEL

    @pytest.mark.asyncio
    async def test_a_server_error_during_listing_still_fails(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """500 means broken, not "not implemented"."""
        self.install_status(monkeypatch, 500)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok", copilot_sdk_byok=custom_block()
            )
        )

        assert result.ok is False
        assert "/models" in result.message


class TestCapabilityMessaging:
    @pytest.mark.asyncio
    async def test_a_successful_check_states_what_is_still_required(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_http_stub(monkeypatch, payload={"data": [{"id": CUSTOM_MODEL}]})
        install_sdk_stub(monkeypatch)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok", copilot_sdk_byok=custom_block()
            )
        )

        assert result.ok is True
        assert "vision" in result.message
        assert "tool calling" in result.message

    @pytest.mark.parametrize(
        "message",
        [
            "This model does not support tools",
            "function calling is not available for this model",
            "image_url is not supported by this model",
            "vision is not supported",
        ],
    )
    def test_a_capability_gap_is_reported_as_a_model_problem(
        self, message: str
    ) -> None:
        info = classify_provider_error(Exception(message), "copilot-byok")

        assert info.category == "model"
        assert "vision" in info.message
        assert "tool calling" in info.message

    @pytest.mark.asyncio
    async def test_a_capability_failure_during_the_probe_is_actionable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import copilot

        install_http_stub(monkeypatch, payload={"data": [{"id": CUSTOM_MODEL}]})

        class StubClient:
            def __init__(self, **kwargs: Any) -> None:
                return None

            async def start(self) -> None:
                return None

            async def create_session(self, **kwargs: Any) -> object:
                raise Exception("This model does not support tools")

            async def stop(self) -> None:
                return None

        monkeypatch.setattr(copilot, "CopilotClient", StubClient)

        result = await validate_provider(
            ProviderValidationRequest(
                provider="copilot-byok", copilot_sdk_byok=custom_block()
            )
        )

        assert result.ok is False
        assert result.category == "model"
        assert "tool calling" in result.message
        assert result.models == (CUSTOM_MODEL,)
