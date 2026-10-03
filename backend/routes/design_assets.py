"""Persist bounded image assets imported from external design tools."""

from __future__ import annotations

import base64
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from image_generation.assets import persist_image_bytes
from image_generation.errors import ImageProviderFailure
from uploaded_assets.store import MAX_UPLOADED_ASSET_BYTES

router = APIRouter()

MAX_DESIGN_ASSETS = 40
MAX_DESIGN_ASSET_TOTAL_BYTES = 40 * 1024 * 1024
SUPPORTED_DESIGN_IMAGE_TYPES = {
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}


class DesignAssetInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    content_base64: str = Field(min_length=1)
    mime_type: str = Field(min_length=1, max_length=100)
    source: Literal["figma", "stitch"]
    kind: str = Field(min_length=1, max_length=80)


class PersistDesignAssetsRequest(BaseModel):
    assets: list[DesignAssetInput] = Field(max_length=MAX_DESIGN_ASSETS)


@router.post("/api/design-assets/persist")
async def persist_design_assets(
    payload: PersistDesignAssetsRequest,
    request: Request,
) -> dict[str, object]:
    asset_base_url = str(request.base_url).rstrip("/")
    persisted: list[dict[str, str]] = []
    warnings: list[str] = []
    total_bytes = 0

    for asset in payload.assets:
        mime_type = asset.mime_type.split(";", 1)[0].strip().lower()
        if mime_type not in SUPPORTED_DESIGN_IMAGE_TYPES:
            warnings.append(
                f"{asset.name} was skipped because {mime_type} is not a "
                "supported reusable image type."
            )
            continue
        try:
            data = base64.b64decode(asset.content_base64, validate=True)
        except ValueError:
            warnings.append(f"{asset.name} was skipped because its data is invalid.")
            continue
        if not data or len(data) > MAX_UPLOADED_ASSET_BYTES:
            warnings.append(
                f"{asset.name} was skipped because it is empty or over 20 MB."
            )
            continue
        if total_bytes + len(data) > MAX_DESIGN_ASSET_TOTAL_BYTES:
            warnings.append(
                "Additional design assets were skipped after the 40 MB import "
                "limit was reached."
            )
            break

        try:
            normalized = await persist_image_bytes(
                data,
                asset_base_url=asset_base_url,
                provider=asset.source,
                mime_hint=mime_type,
            )
        except ImageProviderFailure as error:
            warnings.append(f"{asset.name} was skipped: {error.message}")
            continue

        total_bytes += len(data)
        persisted.append(
            {
                "name": asset.name.strip(),
                "url": normalized.url,
                "mimeType": normalized.mime_type,
                "source": asset.source,
                "kind": asset.kind.strip(),
            }
        )

    return {"sourceAssets": persisted, "warnings": warnings}
