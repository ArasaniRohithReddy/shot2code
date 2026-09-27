"""Read-only discovery from the official Model Context Protocol Registry."""

from __future__ import annotations

from typing import Any, cast
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter()

REGISTRY_SERVERS_URL = "https://registry.modelcontextprotocol.io/v0.1/servers"
MAX_REGISTRY_RESULTS = 40


class RegistryMcpServer(BaseModel):
    name: str
    title: str
    description: str
    version: str
    transport: str
    url: str
    repository_url: str | None = None
    status: str
    is_latest: bool


def _empty_servers() -> list[RegistryMcpServer]:
    return []


class RegistryMcpResponse(BaseModel):
    servers: list[RegistryMcpServer] = Field(default_factory=_empty_servers)


def _safe_https_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return None
    if parsed.scheme != "https" or not parsed.hostname:
        return None
    if parsed.username or parsed.password:
        return None
    return candidate


def _normalize_registry_entries(payload: object) -> list[RegistryMcpServer]:
    if not isinstance(payload, dict):
        return []
    raw_payload = cast(dict[str, object], payload)
    raw_entries = raw_payload.get("servers")
    if not isinstance(raw_entries, list):
        return []

    # The registry search can return several versions. Keep one version per
    # server, preferring the entry explicitly marked latest.
    selected: dict[str, RegistryMcpServer] = {}
    for raw_entry in cast(list[object], raw_entries):
        if not isinstance(raw_entry, dict):
            continue
        raw_entry = cast(dict[str, object], raw_entry)
        raw_server = raw_entry.get("server")
        raw_meta = raw_entry.get("_meta")
        if not isinstance(raw_server, dict) or not isinstance(raw_meta, dict):
            continue
        raw_server = cast(dict[str, object], raw_server)
        raw_meta = cast(dict[str, object], raw_meta)
        name = raw_server.get("name")
        description = raw_server.get("description")
        version = raw_server.get("version")
        if not isinstance(name, str) or not name.strip():
            continue
        if not isinstance(description, str) or not description.strip():
            continue
        if not isinstance(version, str) or not version.strip():
            continue
        clean_name = name.strip()
        clean_description = description.strip()
        clean_version = version.strip()

        remotes = raw_server.get("remotes")
        if not isinstance(remotes, list):
            continue
        remote_url: str | None = None
        transport = ""
        for remote in cast(list[object], remotes):
            if not isinstance(remote, dict):
                continue
            remote = cast(dict[str, object], remote)
            remote_type = remote.get("type")
            candidate = _safe_https_url(remote.get("url"))
            if (
                candidate
                and remote_type in {"streamable-http", "http", "sse"}
            ):
                remote_url = candidate
                transport = "sse" if remote_type == "sse" else "http"
                break
        if remote_url is None:
            continue

        official_meta = raw_meta.get("io.modelcontextprotocol.registry/official")
        if not isinstance(official_meta, dict):
            continue
        official_meta = cast(dict[str, object], official_meta)
        status = official_meta.get("status")
        is_latest = official_meta.get("isLatest") is True
        if status != "active":
            continue
        clean_status = "active"

        repository_url: str | None = None
        repository = raw_server.get("repository")
        if isinstance(repository, dict):
            repository_url = _safe_https_url(
                cast(dict[str, object], repository).get("url")
            )
        raw_title = raw_server.get("title")
        title = (
            raw_title.strip()
            if isinstance(raw_title, str) and raw_title.strip()
            else clean_name
        )

        entry = RegistryMcpServer(
            name=clean_name,
            title=title,
            description=clean_description,
            version=clean_version,
            transport=transport,
            url=remote_url,
            repository_url=repository_url,
            status=clean_status,
            is_latest=is_latest,
        )
        current = selected.get(entry.name)
        if current is None or (entry.is_latest and not current.is_latest):
            selected[entry.name] = entry

    return sorted(
        selected.values(),
        key=lambda item: (not item.is_latest, item.title.casefold()),
    )


@router.get("/api/mcp-registry", response_model=RegistryMcpResponse)
async def search_mcp_registry(
    query: str = Query(default="", max_length=100),
    limit: int = Query(default=20, ge=1, le=MAX_REGISTRY_RESULTS),
) -> RegistryMcpResponse:
    params: dict[str, str | int] = {"limit": limit}
    if query.strip():
        params["search"] = query.strip()

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(REGISTRY_SERVERS_URL, params=params)
            response.raise_for_status()
            payload: Any = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "The MCP Registry could not be reached. Existing server "
                "configurations are unaffected."
            ),
        ) from exc

    return RegistryMcpResponse(
        servers=_normalize_registry_entries(payload)[:limit]
    )
