"""What a user may pick as an image model, and whether a custom one works.

Two endpoints, both cheap and both honest.

``GET /api/image-models`` returns the curated list from
:mod:`image_generation.catalog` with its cost wording attached, so Settings
never invents a price or implies an allocation the provider has not promised.
It is a pure read: no credentials in, none out.

``POST /api/image-models/validate`` is the *only* way a Replicate model that is
not in that list becomes usable. It reads the model's own OpenAPI schema from
Replicate and accepts it only if the model really declares a string ``prompt``
input and an image output. Claiming an arbitrary model is compatible without
that check is exactly what this endpoint exists to avoid.
"""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from config import REPLICATE_API_KEY
from image_generation.catalog import (
    BUILT_IN_IMAGE_MODELS,
    CLOUDFLARE_ALLOCATION_NOTE,
    IMAGE_PROVIDERS,
    BACKGROUND_REMOVAL_PROVIDERS,
    EDITING_PROVIDERS,
    default_model_for,
)
from image_generation.errors import ImageProviderFailure
from image_generation.replicate import validate_model_schema

router = APIRouter()


class ImageModelEntry(BaseModel):
    id: str
    provider: str
    label: str
    costNote: str
    pricingUrl: str


class ImageProviderEntry(BaseModel):
    id: str
    defaultModel: str
    supportsBackgroundRemoval: bool
    supportsEditing: bool
    # True when a user may type a model id this build has never seen. Only
    # Replicate qualifies, and only because its schema can be checked first.
    supportsCustomModels: bool


class ImageModelCatalogResponse(BaseModel):
    providers: list[ImageProviderEntry]
    models: list[ImageModelEntry]
    cloudflareAllocationNote: str


class ImageModelValidationBody(BaseModel):
    provider: str
    model: str
    apiKey: str | None = None


class ImageModelValidationResponse(BaseModel):
    ok: bool
    provider: str
    model: str
    message: str
    category: str = "ready"


@router.get("/api/image-models", response_model=ImageModelCatalogResponse)
async def get_image_models() -> ImageModelCatalogResponse:
    return ImageModelCatalogResponse(
        providers=[
            ImageProviderEntry(
                id=provider,
                defaultModel=default_model_for(provider),
                supportsBackgroundRemoval=provider in BACKGROUND_REMOVAL_PROVIDERS,
                supportsEditing=provider in EDITING_PROVIDERS,
                supportsCustomModels=provider == "replicate",
            )
            for provider in IMAGE_PROVIDERS
        ],
        models=[
            ImageModelEntry(
                id=model.id,
                provider=model.provider,
                label=model.label,
                costNote=model.cost_note,
                pricingUrl=model.pricing_url,
            )
            for model in BUILT_IN_IMAGE_MODELS
        ],
        cloudflareAllocationNote=CLOUDFLARE_ALLOCATION_NOTE,
    )


@router.post("/api/image-models/validate", response_model=ImageModelValidationResponse)
async def post_image_model_validate(
    body: ImageModelValidationBody,
) -> ImageModelValidationResponse:
    model = (body.model or "").strip()
    if body.provider != "replicate":
        return ImageModelValidationResponse(
            ok=False,
            provider=body.provider,
            model=model,
            category="configuration",
            message=(
                "Only Replicate models can be checked this way, because "
                "Replicate is the only provider here that publishes a "
                "per-model input schema."
            ),
        )

    key = (body.apiKey or "").strip() or (REPLICATE_API_KEY or "").strip()
    if not key:
        return ImageModelValidationResponse(
            ok=False,
            provider="replicate",
            model=model,
            category="credentials",
            message=(
                "Add a Replicate API key first; the model's schema is read "
                "from your account."
            ),
        )

    try:
        result = await validate_model_schema(model, key)
    except ImageProviderFailure as failure:
        return ImageModelValidationResponse(
            ok=False,
            provider="replicate",
            model=model,
            category=failure.category,
            message=failure.message,
        )
    except Exception as error:  # noqa: BLE001 - reported, never raised at the client
        return ImageModelValidationResponse(
            ok=False,
            provider="replicate",
            model=model,
            category="unknown",
            message=f"Could not check this model: {type(error).__name__}.",
        )

    return ImageModelValidationResponse(
        ok=result.ok,
        provider="replicate",
        model=result.model,
        category="ready" if result.ok else "model",
        message=result.message,
    )


__all__: list[Any] = ["router"]
