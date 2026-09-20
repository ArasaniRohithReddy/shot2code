"""Validate BYOK and MCP settings without running anything.

The Settings dialog needs to tell a user that a configuration is wrong *before*
a generation fails halfway through. This endpoint answers exactly the question
the generate socket would ask, using the same validator, and nothing else: no
MCP server is spawned, no endpoint is contacted, and no credential is echoed
back. A server that is merely disabled or untrusted is reported as a
diagnostic, not an error.
"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from integrations.config import (
    IntegrationConfigError,
    parse_integration_settings,
)
from model_catalog import ProviderCredentials, build_catalog

router = APIRouter()


def _no_entries() -> list[dict[str, Any]]:
    return []


def _no_names() -> list[str]:
    return []


class IntegrationValidationRequest(BaseModel):
    copilotSdkByok: dict[str, Any] | None = None
    mcpServers: list[dict[str, Any]] | None = None


class IntegrationValidationResponse(BaseModel):
    valid: bool
    error: str | None = None
    # Presence flags and hosts only - never a key, header value or env value.
    byok_enabled: bool = False
    byok: dict[str, Any] | None = None
    byok_selection_ids: list[str] = Field(default_factory=_no_names)
    mcp_servers: list[dict[str, Any]] = Field(default_factory=_no_entries)
    active_mcp_servers: list[str] = Field(default_factory=_no_names)
    diagnostics: list[dict[str, Any]] = Field(default_factory=_no_entries)


@router.post(
    "/api/integrations/validate", response_model=IntegrationValidationResponse
)
async def validate_integrations(
    request: IntegrationValidationRequest,
) -> IntegrationValidationResponse:
    payload: dict[str, Any] = {}
    if request.copilotSdkByok is not None:
        payload["copilotSdkByok"] = request.copilotSdkByok
    if request.mcpServers is not None:
        payload["mcpServers"] = request.mcpServers

    try:
        settings = parse_integration_settings(payload)
    except IntegrationConfigError as error:
        return IntegrationValidationResponse(valid=False, error=str(error))

    summary = settings.byok_summary
    catalog = build_catalog(ProviderCredentials(byok=summary))
    byok_group = next(
        provider for provider in catalog.providers if provider.id == "sdk-byok"
    )

    return IntegrationValidationResponse(
        valid=True,
        byok_enabled=settings.byok_enabled,
        byok=summary.to_dict() if summary else None,
        # The run identities this connection would make selectable. No MCP
        # server is started and no endpoint is contacted to answer this.
        byok_selection_ids=[model.id for model in byok_group.models],
        mcp_servers=[server.safe_metadata() for server in settings.mcp_servers],
        active_mcp_servers=[
            server.key for server in settings.active_mcp_servers
        ],
        diagnostics=[item.to_dict() for item in settings.diagnostics],
    )
