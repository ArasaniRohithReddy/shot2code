"""Check a web-search configuration without running a generation.

Two questions, answered separately on purpose:

* ``/api/web-search/validate`` is pure. It says whether the saved block would
  be accepted and what it resolves to. Nothing leaves this machine.
* ``/api/web-search/test`` actually calls the provider once, with a fixed
  harmless query, so a person can find out that a key is wrong *before* a
  generation spends a turn discovering it. That request costs one credit, so
  it only ever happens when the user presses the button.

Neither response contains the credential. Both report presence flags, the
fixed endpoint, and an actionable sentence when something is wrong.
"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from config import EXA_API_KEY, TAVILY_API_KEY
from web_search.config import (
    WebSearchConfigError,
    merge_web_search_api_key,
    parse_web_search_settings,
)
from web_search.errors import WebSearchError
from web_search.providers import run_provider_search

router = APIRouter()

# A deliberately dull, stable query. It proves the credential and the endpoint
# work without revealing anything about the user's project.
TEST_QUERY = "web content accessibility guidelines"


class WebSearchRequest(BaseModel):
    webSearch: dict[str, Any] | None = None


class WebSearchValidationResponse(BaseModel):
    valid: bool
    error: str | None = None
    enabled: bool = False
    usable: bool = False
    # Presence flags, the fixed endpoint and limits - never the key itself.
    webSearch: dict[str, Any] | None = None


class WebSearchTestResponse(BaseModel):
    ok: bool
    error: str | None = None
    errorCode: str | None = None
    provider: str | None = None
    providerLabel: str | None = None
    accessMode: str | None = None
    resultCount: int = 0


def _settings_from(request: WebSearchRequest):
    payload: dict[str, Any] = {}
    if request.webSearch is not None:
        payload["webSearch"] = request.webSearch
    settings = parse_web_search_settings(payload)
    return merge_web_search_api_key(
        settings,
        TAVILY_API_KEY if settings.provider == "tavily" else EXA_API_KEY,
    )


@router.post("/api/web-search/validate", response_model=WebSearchValidationResponse)
async def validate_web_search(
    request: WebSearchRequest,
) -> WebSearchValidationResponse:
    try:
        settings = _settings_from(request)
    except WebSearchConfigError as error:
        return WebSearchValidationResponse(valid=False, error=str(error))

    return WebSearchValidationResponse(
        valid=True,
        enabled=settings.enabled,
        usable=settings.is_usable,
        webSearch=settings.safe_metadata(),
    )


@router.post("/api/web-search/test", response_model=WebSearchTestResponse)
async def test_web_search(request: WebSearchRequest) -> WebSearchTestResponse:
    try:
        settings = _settings_from(request)
    except WebSearchConfigError as error:
        return WebSearchTestResponse(
            ok=False, error=str(error), errorCode="invalid_request"
        )

    reason = settings.unusable_reason
    if reason is not None:
        return WebSearchTestResponse(
            ok=False,
            error=reason,
            errorCode="not_configured",
            provider=settings.provider,
            providerLabel=settings.provider_label,
            accessMode=settings.access_mode,
        )

    try:
        results = await run_provider_search(
            settings,
            query=TEST_QUERY,
            max_results=1,
            recency="any",
            include_domains=[],
        )
    except WebSearchError as error:
        return WebSearchTestResponse(
            ok=False,
            error=error.message,
            errorCode=error.code,
            provider=settings.provider,
            providerLabel=settings.provider_label,
            accessMode=settings.access_mode,
        )

    return WebSearchTestResponse(
        ok=True,
        provider=settings.provider,
        providerLabel=settings.provider_label,
        accessMode=settings.access_mode,
        resultCount=len(results),
    )
