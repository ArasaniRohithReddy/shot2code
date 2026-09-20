"""Live "would this provider actually work?" checks for Settings.

A key's shape proves nothing, so this endpoint makes one deliberately tiny
request per provider and reports the outcome in the same categories the
generation stream uses. Credentials are read from the request when present and
from the backend environment otherwise; neither is ever echoed back.
"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from provider_validation import (
    ProviderValidationRequest,
    ValidatableProvider,
    validate_provider,
)

router = APIRouter()


class ProviderValidationBody(BaseModel):
    provider: ValidatableProvider
    modelId: str | None = None
    apiKey: str | None = None
    baseUrl: str | None = None
    copilotSdkByok: dict[str, Any] | None = None


class ProviderValidationResponse(BaseModel):
    provider: str
    ok: bool
    category: str
    message: str
    modelId: str | None = None
    # Model ids the endpoint reported, when it could be asked. Bounded, and
    # never invented: an empty list means "not listed", not "none available".
    models: list[str] = []


@router.post("/api/providers/validate", response_model=ProviderValidationResponse)
async def post_provider_validate(
    body: ProviderValidationBody,
) -> ProviderValidationResponse:
    result = await validate_provider(
        ProviderValidationRequest(
            provider=body.provider,
            model_id=body.modelId,
            api_key=body.apiKey,
            base_url=body.baseUrl,
            copilot_sdk_byok=body.copilotSdkByok,
        )
    )
    return ProviderValidationResponse(
        provider=result.provider,
        ok=result.ok,
        category=result.category,
        message=result.message,
        modelId=result.model_id,
        models=list(result.models),
    )
