"""Read Figma design frames through the official REST API."""

from __future__ import annotations

import base64
from typing import Any, cast
from urllib.parse import parse_qs, urlsplit

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

FIGMA_API_BASE = "https://api.figma.com/v1"
MAX_FIGMA_FRAMES = 5


class FigmaImportRequest(BaseModel):
    url: str
    token: str


def parse_figma_url(url: str) -> tuple[str, str | None]:
    parts = urlsplit(url.strip())
    if parts.scheme != "https" or not (parts.hostname or "").endswith("figma.com"):
        raise ValueError("Enter a valid https://www.figma.com design URL.")
    segments = [segment for segment in parts.path.split("/") if segment]
    if len(segments) < 2 or segments[0] not in {
        "design",
        "file",
        "proto",
        "board",
    }:
        raise ValueError("The Figma URL does not contain a file key.")
    file_key = segments[1]
    raw_node = parse_qs(parts.query).get("node-id", [None])[0]
    node_id = raw_node.replace("-", ":") if raw_node else None
    return file_key, node_id


def _top_level_renderable_ids(payload: object) -> list[str]:
    if not isinstance(payload, dict):
        return []
    root = cast(dict[str, object], payload)
    document = root.get("document")
    if not isinstance(document, dict):
        return []
    pages = cast(dict[str, object], document).get("children")
    if not isinstance(pages, list):
        return []
    ids: list[str] = []
    for raw_page in cast(list[object], pages):
        if not isinstance(raw_page, dict):
            continue
        page = cast(dict[str, object], raw_page)
        children = page.get("children")
        if not isinstance(children, list):
            continue
        for raw_child in cast(list[object], children):
            if not isinstance(raw_child, dict):
                continue
            child = cast(dict[str, object], raw_child)
            if child.get("type") not in {
                "FRAME",
                "COMPONENT",
                "INSTANCE",
                "SECTION",
            }:
                continue
            node_id = child.get("id")
            if isinstance(node_id, str) and node_id:
                ids.append(node_id)
            if len(ids) >= MAX_FIGMA_FRAMES:
                return ids
    return ids


async def import_figma_frames(url: str, token: str) -> list[str]:
    file_key, requested_node = parse_figma_url(url)
    headers = {"X-Figma-Token": token}
    async with httpx.AsyncClient(timeout=45) as client:
        node_ids = [requested_node] if requested_node else []
        if not node_ids:
            file_response = await client.get(
                f"{FIGMA_API_BASE}/files/{file_key}",
                headers=headers,
                params={"depth": 2},
            )
            if file_response.status_code in {401, 403}:
                raise PermissionError(
                    "Figma rejected the token or the file is not accessible."
                )
            if file_response.status_code == 404:
                raise FileNotFoundError("The Figma file was not found.")
            file_response.raise_for_status()
            node_ids = _top_level_renderable_ids(file_response.json())
        if not node_ids:
            raise ValueError("No renderable top-level frame was found in the Figma file.")

        image_response = await client.get(
            f"{FIGMA_API_BASE}/images/{file_key}",
            headers=headers,
            params={
                "ids": ",".join(node_ids),
                "format": "png",
                "scale": 2,
            },
        )
        if image_response.status_code in {401, 403}:
            raise PermissionError(
                "Figma rejected the token or the selected frame is not accessible."
            )
        image_response.raise_for_status()
        image_payload = cast(object, image_response.json())
        image_map = (
            cast(dict[str, object], image_payload).get("images")
            if isinstance(image_payload, dict)
            else None
        )
        if not isinstance(image_map, dict):
            raise ValueError("Figma did not return rendered frame images.")
        images_by_node = cast(dict[str, object], image_map)

        results: list[str] = []
        for node_id in node_ids:
            image_url = images_by_node.get(node_id)
            if not isinstance(image_url, str) or not image_url.startswith("https://"):
                continue
            rendered = await client.get(image_url)
            rendered.raise_for_status()
            mime_type = rendered.headers.get("content-type", "image/png").split(";")[0]
            encoded = base64.b64encode(rendered.content).decode("ascii")
            results.append(f"data:{mime_type};base64,{encoded}")
        if not results:
            raise ValueError("Figma could not render the selected frame.")
        return results


@router.post("/api/figma/import")
async def import_figma(request: FigmaImportRequest) -> dict[str, Any]:
    token = request.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Add a Figma personal access token.")
    try:
        images = await import_figma_frames(request.url, token)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except httpx.TimeoutException as error:
        raise HTTPException(
            status_code=504,
            detail="Figma did not answer before the import timed out.",
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail="Could not retrieve the Figma design.",
        ) from error
    return {"images": images}
