"""The BYOK group is additive; the native groups are never relabelled.

The picker must be able to show "direct provider model" and "Copilot SDK BYOK"
as different things for the *same* base model, so the catalog lists them under
different providers with different ids - and turning BYOK on never changes what
the direct providers report.
"""

from typing import Any

from fastapi.testclient import TestClient

from copilot_auth import CopilotAuthSnapshot
from integrations.config import byok_selection_id, parse_integration_settings
from llm import Llm
from model_catalog import ProviderCredentials, build_catalog
from routes import models as models_route

OPENAI_BASE = Llm.GPT_5_6_SOL_HIGH
AZURE_ID = byok_selection_id("azure", OPENAI_BASE)


def byok_block(**overrides: object) -> dict[str, object]:
    block: dict[str, object] = {
        "enabled": True,
        "provider": "azure",
        "baseUrl": "https://res.openai.azure.com",
        "apiKey": "azure-secret",
    }
    block.update(overrides)
    return block


def summary(**overrides: object):
    settings = parse_integration_settings({"copilotSdkByok": byok_block(**overrides)})
    return settings.byok_summary


def provider(catalog: Any, provider_id: str):
    return next(entry for entry in catalog.providers if entry.id == provider_id)


class TestByokProviderCatalog:
    def test_the_connection_lists_its_run_identities(self) -> None:
        catalog = build_catalog(ProviderCredentials(byok=summary()))

        byok = provider(catalog, "sdk-byok")
        assert byok.available is True
        assert byok.credential_source == "sdk-byok"
        assert byok.source_kind == "configured"
        assert AZURE_ID in {model.id for model in byok.models}

    def test_every_entry_carries_its_base_model_and_runtime(self) -> None:
        catalog = build_catalog(ProviderCredentials(byok=summary()))

        entry = next(
            model for model in provider(catalog, "sdk-byok").models
            if model.id == AZURE_ID
        )
        assert entry.runtime == "copilot-byok"
        assert entry.base_model_id == OPENAI_BASE.value
        assert entry.model is OPENAI_BASE
        assert entry.supports_video is False

    def test_an_azure_connection_offers_the_openai_family(self) -> None:
        catalog = build_catalog(ProviderCredentials(byok=summary()))

        bases = {model.base_model_id for model in provider(catalog, "sdk-byok").models}
        assert Llm.GPT_5_5_HIGH.value in bases
        assert Llm.CLAUDE_OPUS_5_MAX.value not in bases

    def test_an_anthropic_connection_offers_the_claude_family(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(
                byok=summary(provider="anthropic", baseUrl=None, apiKey="sk-ant")
            )
        )

        bases = {model.base_model_id for model in provider(catalog, "sdk-byok").models}
        assert Llm.CLAUDE_OPUS_5_MAX.value in bases
        assert Llm.GPT_5_5_HIGH.value not in bases

    def test_gemini_models_are_never_offered_by_byok(self) -> None:
        overrides_list: list[dict[str, Any]] = [
            {},
            {"provider": "openai", "baseUrl": None, "apiKey": "sk-1"},
            {"provider": "anthropic", "baseUrl": None, "apiKey": "sk-ant"},
        ]
        for overrides in overrides_list:
            catalog = build_catalog(ProviderCredentials(byok=summary(**overrides)))
            bases = {
                model.base_model_id for model in provider(catalog, "sdk-byok").models
            }
            assert Llm.GEMINI_3_6_FLASH_LOW.value not in bases

    def test_native_and_byok_ids_coexist_in_one_catalog(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(openai_api_key="sk-direct", byok=summary())
        )

        ids = catalog.model_ids()
        assert OPENAI_BASE.value in ids
        assert AZURE_ID in ids

    def test_a_byok_entry_never_appears_under_a_native_provider(self) -> None:
        catalog = build_catalog(
            ProviderCredentials(openai_api_key="sk-direct", byok=summary())
        )

        openai_ids = {model.id for model in provider(catalog, "openai").models}
        assert AZURE_ID not in openai_ids
        assert OPENAI_BASE.value in openai_ids

    def test_enabling_byok_does_not_change_the_native_providers(self) -> None:
        without = build_catalog(ProviderCredentials(openai_api_key="sk-direct"))
        with_byok = build_catalog(
            ProviderCredentials(openai_api_key="sk-direct", byok=summary())
        )

        for provider_id in ("openai", "anthropic", "gemini", "copilot"):
            before = provider(without, provider_id)
            after = provider(with_byok, provider_id)
            assert before.available == after.available
            assert before.credential_source == after.credential_source
            assert before.detail == after.detail
            assert [m.id for m in before.models] == [m.id for m in after.models]

    def test_byok_alone_never_makes_a_native_provider_available(self) -> None:
        catalog = build_catalog(ProviderCredentials(byok=summary()))

        assert provider(catalog, "openai").available is False
        assert provider(catalog, "anthropic").available is False
        assert provider(catalog, "gemini").available is False

    def test_an_unusable_connection_offers_nothing_and_says_why(self) -> None:
        catalog = build_catalog(ProviderCredentials(byok=summary(apiKey=None)))

        byok = provider(catalog, "sdk-byok")
        assert byok.available is False
        assert byok.models == ()
        assert "API key" in byok.detail

    def test_with_no_connection_the_group_is_present_but_empty(self) -> None:
        catalog = build_catalog(ProviderCredentials())

        byok = provider(catalog, "sdk-byok")
        assert byok.available is False
        assert byok.models == ()
        assert byok.credential_source is None

    def test_a_switched_off_connection_offers_nothing(self) -> None:
        catalog = build_catalog(ProviderCredentials(byok=summary(enabled=False)))

        assert provider(catalog, "sdk-byok").available is False


class TestModelsRoute:
    def client(self, monkeypatch: Any) -> TestClient:
        async def fake_snapshot(**_: object) -> CopilotAuthSnapshot:
            return CopilotAuthSnapshot(available=False, login=None, models=[])

        monkeypatch.setattr(models_route, "get_copilot_snapshot", fake_snapshot)
        monkeypatch.setattr(models_route, "OPENAI_API_KEY", None)
        monkeypatch.setattr(models_route, "ANTHROPIC_API_KEY", None)
        monkeypatch.setattr(models_route, "GEMINI_API_KEY", None)

        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(models_route.router)
        return TestClient(app)

    def test_byok_is_reported_as_its_own_provider(self, monkeypatch: Any) -> None:
        client = self.client(monkeypatch)

        response = client.post(
            "/api/models", json={"copilotSdkByok": byok_block()}
        )

        assert response.status_code == 200
        body = response.json()
        byok = next(p for p in body["providers"] if p["id"] == "sdk-byok")
        assert byok["available"] is True
        assert byok["credential_source"] == "sdk-byok"
        entry = next(m for m in byok["models"] if m["id"] == AZURE_ID)
        assert entry["runtime"] == "copilot-byok"
        assert entry["base_model_id"] == OPENAI_BASE.value
        assert "azure-secret" not in response.text

    def test_native_entries_report_the_native_runtime(self, monkeypatch: Any) -> None:
        client = self.client(monkeypatch)

        response = client.post("/api/models", json={"openAiApiKey": "sk-direct"})

        body = response.json()
        openai = next(p for p in body["providers"] if p["id"] == "openai")
        assert openai["credential_source"] == "request"
        assert all(model["runtime"] == "native" for model in openai["models"])
        assert all(model["base_model_id"] is None for model in openai["models"])

    def test_native_providers_stay_unavailable_without_their_own_keys(
        self, monkeypatch: Any
    ) -> None:
        client = self.client(monkeypatch)

        response = client.post("/api/models", json={"copilotSdkByok": byok_block()})

        body = response.json()
        for provider_id in ("openai", "anthropic", "gemini"):
            entry = next(p for p in body["providers"] if p["id"] == provider_id)
            assert entry["available"] is False
            assert entry["credential_source"] is None
            assert entry["models"] == []

    def test_gemini_limitation_is_reported(self, monkeypatch: Any) -> None:
        client = self.client(monkeypatch)

        response = client.post("/api/models", json={"copilotSdkByok": byok_block()})

        codes = {
            item["code"] for item in response.json()["integration_diagnostics"]
        }
        assert "gemini_not_supported" in codes

    def test_an_invalid_byok_block_does_not_break_the_picker(
        self, monkeypatch: Any
    ) -> None:
        client = self.client(monkeypatch)

        response = client.post(
            "/api/models",
            json={
                "openAiApiKey": "sk-direct",
                "copilotSdkByok": byok_block(provider="bedrock"),
            },
        )

        assert response.status_code == 200
        body = response.json()
        openai = next(p for p in body["providers"] if p["id"] == "openai")
        assert openai["available"] is True, "a direct key keeps working"
        assert body["integration_diagnostics"][0]["code"] == "invalid"

    def test_a_request_without_byok_behaves_as_before(self, monkeypatch: Any) -> None:
        client = self.client(monkeypatch)

        response = client.post("/api/models", json={"openAiApiKey": "sk-direct"})

        body = response.json()
        byok = next(p for p in body["providers"] if p["id"] == "sdk-byok")
        assert byok["available"] is False
        assert body["integration_diagnostics"] == []


class TestIntegrationValidationRoute:
    def client(self) -> TestClient:
        from fastapi import FastAPI

        from routes import integrations as integrations_route

        app = FastAPI()
        app.include_router(integrations_route.router)
        return TestClient(app)

    def test_a_valid_configuration_reports_safe_metadata_only(self) -> None:
        response = self.client().post(
            "/api/integrations/validate",
            json={
                "copilotSdkByok": byok_block(),
                "mcpServers": [
                    {
                        "id": "docs",
                        "name": "Docs",
                        "enabled": True,
                        "trusted": True,
                        "transport": "stdio",
                        "command": "npx",
                        "env": {"DOCS_TOKEN": "env-secret"},
                    }
                ],
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["valid"] is True
        assert body["byok_enabled"] is True
        assert body["byok"]["hasApiKey"] is True
        assert body["byok"]["baseUrlHost"] == "res.openai.azure.com"
        assert AZURE_ID in body["byok_selection_ids"]
        assert body["active_mcp_servers"] == ["docs"]
        assert "azure-secret" not in response.text
        assert "env-secret" not in response.text
        assert "DOCS_TOKEN" in response.text

    def test_an_incomplete_connection_is_reported_with_a_reason(self) -> None:
        response = self.client().post(
            "/api/integrations/validate",
            json={"copilotSdkByok": byok_block(apiKey=None)},
        )

        body = response.json()
        assert body["valid"] is True
        assert body["byok"]["usable"] is False
        assert "API key" in body["byok"]["reason"]
        assert body["byok_selection_ids"] == []

    def test_an_invalid_configuration_is_explained_not_raised(self) -> None:
        response = self.client().post(
            "/api/integrations/validate",
            json={
                "mcpServers": [
                    {
                        "name": "Bad",
                        "enabled": True,
                        "trusted": True,
                        "transport": "stdio",
                    }
                ]
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["valid"] is False
        assert "command" in body["error"]

    def test_inactive_servers_are_listed_with_a_reason(self) -> None:
        response = self.client().post(
            "/api/integrations/validate",
            json={
                "mcpServers": [
                    {
                        "id": "u",
                        "name": "Untrusted",
                        "enabled": True,
                        "trusted": False,
                        "transport": "http",
                        "url": "https://mcp.example.com",
                    }
                ]
            },
        )

        body = response.json()
        assert body["valid"] is True
        assert body["active_mcp_servers"] == []
        assert body["diagnostics"][0]["code"] == "untrusted"

    def test_an_empty_request_is_valid_and_empty(self) -> None:
        response = self.client().post("/api/integrations/validate", json={})

        body = response.json()
        assert body == {
            "valid": True,
            "error": None,
            "byok_enabled": False,
            "byok": None,
            "byok_selection_ids": [],
            "mcp_servers": [],
            "active_mcp_servers": [],
            "diagnostics": [],
        }
