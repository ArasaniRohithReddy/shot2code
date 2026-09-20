"""The catalog endpoint the pickers read, including its secret-handling."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from typing import Any, cast

import routes.models as models_route
from copilot_auth import CopilotAuthSnapshot
from llm import Llm


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    async def fake_snapshot(
        github_token: str | None = None, force: bool = False
    ) -> CopilotAuthSnapshot:
        if github_token == "github_pat_valid" or github_token is None:
            return CopilotAuthSnapshot(
                available=True,
                login="octocat",
                models=[
                    {"id": "claude-opus-5", "vision": True},
                    {"id": "gpt-5.6-sol", "vision": True},
                    {"id": "text-only-model", "vision": False},
                    {"id": "brand-new-model-9", "vision": True},
                ],
            )
        return CopilotAuthSnapshot(available=False, login=None, models=[])

    monkeypatch.setattr(models_route, "get_copilot_snapshot", fake_snapshot)
    monkeypatch.setattr(models_route, "OPENAI_API_KEY", None)
    monkeypatch.setattr(models_route, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(models_route, "GEMINI_API_KEY", None)

    app = FastAPI()
    app.include_router(models_route.router)
    return TestClient(app)


def providers(payload: dict[str, object]) -> dict[str, dict[str, Any]]:
    entries = payload["providers"]
    assert isinstance(entries, list)
    typed: list[dict[str, Any]] = cast(list[dict[str, Any]], entries)
    return {str(entry["id"]): entry for entry in typed}


def model_ids(provider: dict[str, Any]) -> list[str]:
    models: list[dict[str, Any]] = provider["models"]
    return [str(model["id"]) for model in models]


class TestModelCatalogEndpoint:
    def test_get_reports_every_provider(self, client: TestClient) -> None:
        response = client.get("/api/models")

        assert response.status_code == 200
        by_id = providers(response.json())
        assert set(by_id) == {
            "copilot",
            "openai",
            "anthropic",
            "gemini",
            "sdk-byok",
        }

    def test_providers_without_credentials_are_unavailable_and_empty(
        self, client: TestClient
    ) -> None:
        by_id = providers(client.get("/api/models").json())

        for provider_id in ("openai", "anthropic", "gemini"):
            assert by_id[provider_id]["available"] is False
            assert by_id[provider_id]["models"] == []
            assert by_id[provider_id]["credential_label"]

    def test_browser_keys_unlock_their_provider(self, client: TestClient) -> None:
        response = client.post(
            "/api/models", json={"openAiApiKey": "sk-test", "geminiApiKey": "g-test"}
        )

        by_id = providers(response.json())
        assert by_id["openai"]["available"] is True
        assert by_id["openai"]["credential_source"] == "request"
        assert by_id["gemini"]["available"] is True
        assert by_id["anthropic"]["available"] is False
        assert len(model_ids(by_id["openai"])) > 0

    def test_environment_keys_are_reported_as_such(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(models_route, "ANTHROPIC_API_KEY", "sk-from-env")

        by_id = providers(client.post("/api/models", json={}).json())

        assert by_id["anthropic"]["available"] is True
        assert by_id["anthropic"]["credential_source"] == "environment"

    def test_copilot_models_come_from_live_discovery(self, client: TestClient) -> None:
        by_id = providers(client.get("/api/models").json())

        copilot = by_id["copilot"]
        assert copilot["available"] is True
        assert copilot["source_kind"] == "discovered"
        assert model_ids(copilot) == [
            Llm.COPILOT_CLAUDE_OPUS_5.value,
            Llm.COPILOT_GPT_5_6_SOL.value,
        ]
        # Text-only models are not offered at all; ids this build cannot route
        # are named so the UI can explain their absence.
        assert copilot["unsupported_model_ids"] == ["brand-new-model-9"]

    def test_an_invalid_token_leaves_copilot_unavailable(
        self, client: TestClient
    ) -> None:
        by_id = providers(
            client.post("/api/models", json={"copilotGithubToken": "bad"}).json()
        )

        assert by_id["copilot"]["available"] is False
        assert by_id["copilot"]["models"] == []

    def test_stale_selection_is_reported_for_the_saved_picks(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/api/models",
            json={
                "openAiApiKey": "sk-test",
                "selectedModels": [
                    Llm.GPT_5_5_HIGH.value,
                    Llm.CLAUDE_OPUS_5_HIGH.value,
                    Llm.COPILOT_CLAUDE_OPUS_5.value,
                    "ghost-model",
                ],
            },
        )

        assert response.json()["stale_selection"] == [
            Llm.CLAUDE_OPUS_5_HIGH.value,
            "ghost-model",
        ]

    def test_no_credential_is_echoed_back(self, client: TestClient) -> None:
        response = client.post(
            "/api/models",
            json={
                "openAiApiKey": "sk-openai-secret",
                "anthropicApiKey": "sk-anthropic-secret",
                "geminiApiKey": "gemini-secret",
                "copilotGithubToken": "github_pat_valid",
            },
        )

        body = response.text
        for secret in (
            "sk-openai-secret",
            "sk-anthropic-secret",
            "gemini-secret",
            "github_pat_valid",
        ):
            assert secret not in body
