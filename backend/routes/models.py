"""The model catalog the frontend renders in its pickers.

Credentials may arrive in the request body because the Settings dialog keeps
keys in the browser rather than on the server. They are used to answer "is this
provider usable" and are never echoed back, logged, or persisted.
"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from config import ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY
from copilot_auth import get_copilot_snapshot
from integrations.config import (
    ByokConnectionSummary,
    IntegrationConfigError,
    parse_integration_settings,
)
from llm import ModelProvider
from model_catalog import (
    CatalogModel,
    ModelCatalog,
    ProviderCredentials,
    build_catalog,
    stale_selection_ids,
)

router = APIRouter()


def _no_diagnostics() -> list[dict[str, Any]]:
    return []


class ModelEntry(BaseModel):
    id: str
    provider: ModelProvider
    label: str
    family: str
    effort: str | None = None
    status: str
    recommended: bool
    supports_video: bool
    # Copilot SDK BYOK entries carry the run identity in `id` plus the direct
    # model whose capabilities they borrow. Native entries have runtime
    # "native" and no base model, exactly as before BYOK existed.
    runtime: str = "native"
    base_model_id: str | None = None


class ProviderEntry(BaseModel):
    id: ModelProvider
    label: str
    available: bool
    credential_label: str
    credential_source: str | None = None
    source_kind: str
    detail: str
    models: list[ModelEntry]
    unsupported_model_ids: list[str] = Field(default_factory=list)


class ModelCatalogResponse(BaseModel):
    providers: list[ProviderEntry]
    stale_selection: list[str] = Field(default_factory=list)
    # Why part of the integration configuration is not in play, in safe words.
    integration_diagnostics: list[dict[str, Any]] = Field(
        default_factory=_no_diagnostics
    )


class ModelCatalogRequest(BaseModel):
    """Credentials held by the browser, plus the selection to validate."""

    openAiApiKey: str | None = None
    anthropicApiKey: str | None = None
    geminiApiKey: str | None = None
    copilotGithubToken: str | None = None
    selectedModels: list[str] = Field(default_factory=list)
    refresh: bool = False
    # Copilot SDK BYOK connection, in the same shape the generate socket takes.
    copilotSdkByok: dict[str, Any] | None = None


def _serialize_model(model: CatalogModel) -> ModelEntry:
    return ModelEntry(
        id=model.id,
        provider=model.provider,
        label=model.label,
        family=model.family,
        effort=model.effort,
        status=model.status,
        recommended=model.recommended,
        supports_video=model.supports_video,
        runtime=model.runtime,
        base_model_id=model.base_model_id,
    )


def _serialize(
    catalog: ModelCatalog,
    selected: list[str],
    diagnostics: list[dict[str, Any]] | None = None,
) -> ModelCatalogResponse:
    return ModelCatalogResponse(
        providers=[
            ProviderEntry(
                id=provider.id,
                label=provider.label,
                available=provider.available,
                credential_label=provider.credential_label,
                credential_source=provider.credential_source,
                source_kind=provider.source_kind,
                detail=provider.detail,
                models=[_serialize_model(model) for model in provider.models],
                unsupported_model_ids=list(provider.unsupported_model_ids),
            )
            for provider in catalog.providers
        ],
        stale_selection=list(stale_selection_ids(selected, catalog)),
        integration_diagnostics=list(diagnostics or []),
    )


async def _catalog_for(
    request: ModelCatalogRequest,
) -> ModelCatalogResponse:
    token = (request.copilotGithubToken or "").strip() or None
    snapshot = await get_copilot_snapshot(github_token=token, force=request.refresh)

    # The browser's key wins; otherwise fall back to what the backend was
    # started with. Only the origin is reported back, never the value.
    request_providers: set[ModelProvider] = set()
    openai_key = (request.openAiApiKey or "").strip() or None
    anthropic_key = (request.anthropicApiKey or "").strip() or None
    gemini_key = (request.geminiApiKey or "").strip() or None
    if openai_key:
        request_providers.add("openai")
    if anthropic_key:
        request_providers.add("anthropic")
    if gemini_key:
        request_providers.add("gemini")
    if token:
        request_providers.add("copilot")

    # An invalid BYOK block must not break the picker: the direct providers are
    # unaffected and the reason travels as a diagnostic.
    byok: ByokConnectionSummary | None = None
    diagnostics: list[dict[str, Any]] = []
    if request.copilotSdkByok is not None:
        try:
            settings = parse_integration_settings(
                {"copilotSdkByok": request.copilotSdkByok}
            )
        except IntegrationConfigError as error:
            diagnostics.append(
                {"scope": "byok", "code": "invalid", "message": str(error)}
            )
        else:
            byok = settings.byok_summary
            diagnostics.extend(item.to_dict() for item in settings.diagnostics)

    catalog = build_catalog(
        ProviderCredentials(
            openai_api_key=openai_key or OPENAI_API_KEY,
            anthropic_api_key=anthropic_key or ANTHROPIC_API_KEY,
            gemini_api_key=gemini_key or GEMINI_API_KEY,
            copilot_available=snapshot.available,
            copilot_login=snapshot.login,
            copilot_model_ids=tuple(
                str(model["id"])
                for model in snapshot.models
                if bool(model.get("vision"))
            ),
            request_providers=frozenset(request_providers),
            byok=byok,
        )
    )
    return _serialize(catalog, request.selectedModels, diagnostics)


@router.get("/api/models", response_model=ModelCatalogResponse)
async def get_models(refresh: bool = False) -> ModelCatalogResponse:
    """Catalog for the credentials the backend itself holds."""
    return await _catalog_for(ModelCatalogRequest(refresh=refresh))


@router.post("/api/models", response_model=ModelCatalogResponse)
async def post_models(request: ModelCatalogRequest) -> ModelCatalogResponse:
    """Catalog for the credentials this browser holds, plus stale-pick checks."""
    return await _catalog_for(request)
