"""Read Figma design frames through the official REST API."""

from __future__ import annotations

import base64
import re
from collections.abc import Iterator
from typing import Any, cast
from urllib.parse import parse_qs, urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from image_generation.assets import persist_image_bytes
from uploaded_assets.store import MAX_UPLOADED_ASSET_BYTES

router = APIRouter()

FIGMA_API_BASE = "https://api.figma.com/v1"
MAX_FIGMA_FRAMES = 5
MAX_FIGMA_SOURCE_ASSETS = 40
MAX_FIGMA_EXPORTED_NODES = 20
MAX_FIGMA_ASSET_TOTAL_BYTES = 40 * 1024 * 1024
_UNSAFE_ASSET_NAME = re.compile(r"[^A-Za-z0-9._ -]+")


class FigmaRateLimitError(RuntimeError):
    pass


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


def _walk_nodes(value: object) -> Iterator[dict[str, object]]:
    if not isinstance(value, dict):
        return
    node = cast(dict[str, object], value)
    yield node
    children = node.get("children")
    if isinstance(children, list):
        for child in cast(list[object], children):
            yield from _walk_nodes(child)


def _selected_documents(payload: object) -> list[dict[str, object]]:
    if not isinstance(payload, dict):
        return []
    nodes = cast(dict[str, object], payload).get("nodes")
    if not isinstance(nodes, dict):
        return []
    documents: list[dict[str, object]] = []
    for raw in cast(dict[str, object], nodes).values():
        if not isinstance(raw, dict):
            continue
        document = cast(dict[str, object], raw).get("document")
        if isinstance(document, dict):
            documents.append(cast(dict[str, object], document))
    return documents


def _asset_name(value: object, fallback: str) -> str:
    raw = value if isinstance(value, str) else fallback
    cleaned = _UNSAFE_ASSET_NAME.sub("-", raw).strip(" .-_")
    return (cleaned[:96].strip(" .-_") or fallback).lower().replace(" ", "-")


def _collect_image_fill_refs(
    documents: list[dict[str, object]],
) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for document in documents:
        for node in _walk_nodes(document):
            name = _asset_name(node.get("name"), "figma-image")
            for field in ("fills", "strokes", "background", "backgrounds"):
                paints = node.get(field)
                if not isinstance(paints, list):
                    continue
                for raw_paint in cast(list[object], paints):
                    if not isinstance(raw_paint, dict):
                        continue
                    paint = cast(dict[str, object], raw_paint)
                    image_ref = paint.get("imageRef")
                    if (
                        paint.get("type") == "IMAGE"
                        and isinstance(image_ref, str)
                        and image_ref
                        and image_ref not in seen
                    ):
                        seen.add(image_ref)
                        found.append((image_ref, name))
                        if len(found) >= MAX_FIGMA_SOURCE_ASSETS:
                            return found
    return found


def _collect_export_nodes(
    documents: list[dict[str, object]],
) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for document in documents:
        for node in _walk_nodes(document):
            node_id = node.get("id")
            settings = node.get("exportSettings")
            if (
                not isinstance(node_id, str)
                or not node_id
                or node_id in seen
                or not isinstance(settings, list)
                or not settings
            ):
                continue
            seen.add(node_id)
            found.append(
                (node_id, _asset_name(node.get("name"), "figma-export"))
            )
            if len(found) >= MAX_FIGMA_EXPORTED_NODES:
                return found
    return found


def _raise_for_figma_rate_limit(response: httpx.Response) -> None:
    if response.status_code != 429:
        return
    retry_after = response.headers.get("Retry-After", "").strip()
    plan = response.headers.get("X-Figma-Plan-Tier", "").strip()
    limit_type = response.headers.get("X-Figma-Rate-Limit-Type", "").strip()
    upgrade_url = response.headers.get("X-Figma-Upgrade-Link", "").strip()
    details = ["Figma's REST API rate limit was reached."]
    if retry_after:
        details.append(f"Retry after {retry_after} seconds.")
    if plan:
        details.append(f"Plan: {plan}.")
    if limit_type:
        details.append(f"Limit type: {limit_type}.")
    if upgrade_url.startswith("https://"):
        details.append(f"Figma upgrade guidance: {upgrade_url}")
    details.append(
        "Figma applies particularly small Tier 1 quotas to file and image "
        "rendering requests; wait before retrying or upload an exported frame "
        "instead."
    )
    raise FigmaRateLimitError(" ".join(details))


async def import_figma_frames(url: str, token: str) -> list[str]:
    result = await import_figma_design(url, token, "http://127.0.0.1:7001")
    return result["images"]


async def _download_figma_asset(
    client: httpx.AsyncClient,
    url: str,
    *,
    asset_base_url: str,
    remaining_bytes: int,
) -> tuple[str, str, int]:
    if not url.startswith("https://"):
        raise ValueError("Figma returned an unsafe asset URL.")
    limit = min(MAX_UPLOADED_ASSET_BYTES, max(0, remaining_bytes))
    if limit <= 0:
        raise ValueError("The 40 MB Figma asset limit was reached.")
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        declared = int(response.headers.get("content-length") or "0")
        if declared > limit:
            raise ValueError("A Figma asset exceeded the remaining import limit.")
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > limit:
                raise ValueError(
                    "A Figma asset exceeded the remaining import limit."
                )
        content = bytes(body)
        mime_hint = response.headers.get("content-type", "image/png").split(";")[0]
    normalized = await persist_image_bytes(
        content,
        asset_base_url=asset_base_url,
        provider="figma",
        mime_hint=mime_hint,
    )
    return normalized.url, normalized.mime_type, len(content)


async def import_figma_design(
    url: str,
    token: str,
    asset_base_url: str,
) -> dict[str, Any]:
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
            _raise_for_figma_rate_limit(file_response)
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
        _raise_for_figma_rate_limit(image_response)
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
        source_assets: list[dict[str, str]] = []
        warnings: list[str] = []
        total_asset_bytes = 0
        try:
            nodes_response = await client.get(
                f"{FIGMA_API_BASE}/files/{file_key}/nodes",
                headers=headers,
                params={"ids": ",".join(node_ids)},
            )
            _raise_for_figma_rate_limit(nodes_response)
            nodes_response.raise_for_status()
            documents = _selected_documents(cast(object, nodes_response.json()))

            image_refs = _collect_image_fill_refs(documents)
            if image_refs:
                fills_response = await client.get(
                    f"{FIGMA_API_BASE}/files/{file_key}/images",
                    headers=headers,
                )
                _raise_for_figma_rate_limit(fills_response)
                fills_response.raise_for_status()
                fills_payload = cast(object, fills_response.json())
                meta = (
                    cast(dict[str, object], fills_payload).get("meta")
                    if isinstance(fills_payload, dict)
                    else None
                )
                image_map = (
                    cast(dict[str, object], meta).get("images")
                    if isinstance(meta, dict)
                    else None
                )
                if isinstance(image_map, dict):
                    typed_images = cast(dict[str, object], image_map)
                    for image_ref, name in image_refs:
                        remote_url = typed_images.get(image_ref)
                        if not isinstance(remote_url, str):
                            continue
                        public_url, mime_type, size = await _download_figma_asset(
                            client,
                            remote_url,
                            asset_base_url=asset_base_url,
                            remaining_bytes=(
                                MAX_FIGMA_ASSET_TOTAL_BYTES - total_asset_bytes
                            ),
                        )
                        total_asset_bytes += size
                        source_assets.append(
                            {
                                "name": name,
                                "url": public_url,
                                "mimeType": mime_type,
                                "source": "figma",
                                "kind": "image fill",
                            }
                        )

            remaining = MAX_FIGMA_SOURCE_ASSETS - len(source_assets)
            export_nodes = _collect_export_nodes(documents)[:remaining]
            if export_nodes:
                export_response = await client.get(
                    f"{FIGMA_API_BASE}/images/{file_key}",
                    headers=headers,
                    params={
                        "ids": ",".join(node_id for node_id, _name in export_nodes),
                        "format": "png",
                        "scale": 2,
                    },
                )
                _raise_for_figma_rate_limit(export_response)
                export_response.raise_for_status()
                export_payload = cast(object, export_response.json())
                exported = (
                    cast(dict[str, object], export_payload).get("images")
                    if isinstance(export_payload, dict)
                    else None
                )
                if isinstance(exported, dict):
                    exported_images = cast(dict[str, object], exported)
                    for node_id, name in export_nodes:
                        remote_url = exported_images.get(node_id)
                        if not isinstance(remote_url, str):
                            continue
                        public_url, mime_type, size = await _download_figma_asset(
                            client,
                            remote_url,
                            asset_base_url=asset_base_url,
                            remaining_bytes=(
                                MAX_FIGMA_ASSET_TOTAL_BYTES - total_asset_bytes
                            ),
                        )
                        total_asset_bytes += size
                        source_assets.append(
                            {
                                "name": name,
                                "url": public_url,
                                "mimeType": mime_type,
                                "source": "figma",
                                "kind": "exported node",
                            }
                        )
        except FigmaRateLimitError as error:
            warnings.append(
                f"Frames were imported, but Figma assets were rate limited. {error}"
            )
        except (httpx.HTTPError, ValueError) as error:
            warnings.append(
                "Frames were imported, but some Figma assets could not be "
                f"downloaded: {error}"
            )

        return {
            "images": results,
            "sourceAssets": source_assets,
            "warnings": warnings,
        }


@router.post("/api/figma/import")
async def import_figma(
    request: FigmaImportRequest,
    http_request: Request,
) -> dict[str, Any]:
    token = request.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Add a Figma personal access token.")
    try:
        result = await import_figma_design(
            request.url,
            token,
            str(http_request.base_url).rstrip("/"),
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except FigmaRateLimitError as error:
        raise HTTPException(status_code=429, detail=str(error)) from error
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
    return result
