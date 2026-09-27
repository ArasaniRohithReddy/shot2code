from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.mcp_registry import _normalize_registry_entries, router


def entry(
    name: str,
    version: str,
    *,
    latest: bool,
    url: str = "https://mcp.example.com/mcp",
) -> dict[str, Any]:
    return {
        "server": {
            "name": name,
            "title": "Example",
            "description": "Example tools",
            "version": version,
            "remotes": [{"type": "streamable-http", "url": url}],
            "repository": {"url": "https://github.com/example/mcp"},
        },
        "_meta": {
            "io.modelcontextprotocol.registry/official": {
                "status": "active",
                "isLatest": latest,
            }
        },
    }


def test_registry_entries_keep_the_latest_remote_version() -> None:
    servers = _normalize_registry_entries(
        {
            "servers": [
                entry("com.example/mcp", "1.0.0", latest=False),
                entry("com.example/mcp", "2.0.0", latest=True),
            ]
        }
    )

    assert len(servers) == 1
    assert servers[0].version == "2.0.0"
    assert servers[0].transport == "http"
    assert servers[0].repository_url == "https://github.com/example/mcp"


def test_registry_entries_refuse_plain_http_remote_servers() -> None:
    assert _normalize_registry_entries(
        {
            "servers": [
                entry(
                    "com.example/mcp",
                    "1.0.0",
                    latest=True,
                    url="http://mcp.example.com",
                )
            ]
        }
    ) == []


def test_registry_route_returns_an_actionable_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail(
        _self: httpx.AsyncClient,
        _url: str,
        **_kwargs: object,
    ) -> httpx.Response:
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(httpx.AsyncClient, "get", fail)
    app = FastAPI()
    app.include_router(router)

    response = TestClient(app).get("/api/mcp-registry?query=figma")

    assert response.status_code == 502
    assert "Existing server configurations are unaffected" in response.json()["detail"]
