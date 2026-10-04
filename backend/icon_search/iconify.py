"""Strict client and normalizer for Iconify's fixed public API."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Mapping, Sequence, cast
from urllib.parse import quote, urlsplit

import httpx

from icon_search.config import (
    ICONIFY_API_ORIGIN,
    ICONIFY_SEARCH_PATH,
    ICONIFY_USER_AGENT,
    MAX_SEARCH_RESPONSE_BYTES,
    MAX_SVG_BYTES,
    REQUEST_TIMEOUT_SECONDS,
    SEARCH_CANDIDATE_LIMIT,
    normalize_spdx,
)

_ICON_PART = re.compile(r"^[a-z0-9][a-z0-9-]{0,95}$")
_BRAND_PREFIXES = frozenset({"cib", "fa-brands", "logos", "simple-icons"})


class IconifyError(Exception):
    """A provider or response failure safe to show to the user."""

    def __init__(self, message: str, code: str = "provider_error") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass(frozen=True)
class IconLicense:
    title: str
    spdx: str
    url: str


@dataclass(frozen=True)
class IconCollection:
    prefix: str
    name: str
    author: str
    author_url: str
    license: IconLicense
    category: str
    tags: tuple[str, ...]
    is_brand: bool


@dataclass(frozen=True)
class IconCandidate:
    prefix: str
    name: str
    collection: IconCollection

    @property
    def icon_id(self) -> str:
        return f"{self.prefix}:{self.name}"

    @property
    def source_url(self) -> str:
        return (
            f"{ICONIFY_API_ORIGIN}/{quote(self.prefix, safe='')}/"
            f"{quote(self.name, safe='')}.svg"
        )


def _text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def _safe_http_url(value: object) -> str:
    if not isinstance(value, str):
        return ""
    candidate = value.strip()[:800]
    parts = urlsplit(candidate)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        return ""
    if parts.username or parts.password:
        return ""
    return candidate


def _tags(value: object) -> tuple[str, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(
        tag
        for tag in (_text(item, 80) for item in cast(Sequence[object], value))
        if tag
    )[:20]


def _looks_like_brand(
    prefix: str, name: str, category: str, tags: tuple[str, ...]
) -> bool:
    haystack = " ".join((name, category, *tags)).lower()
    return prefix in _BRAND_PREFIXES or any(
        marker in haystack for marker in ("brand", "logo", "trademark")
    )


def _collection(prefix: str, raw: object) -> IconCollection | None:
    if not _ICON_PART.fullmatch(prefix) or not isinstance(raw, Mapping):
        return None
    record = cast(Mapping[str, Any], raw)
    author_raw = record.get("author")
    license_raw = record.get("license")
    if not isinstance(author_raw, Mapping) or not isinstance(license_raw, Mapping):
        return None
    author_record = cast(Mapping[str, Any], author_raw)
    license_record = cast(Mapping[str, Any], license_raw)

    name = _text(record.get("name"), 160)
    author = _text(author_record.get("name"), 160)
    spdx = normalize_spdx(license_record.get("spdx"))
    license_title = _text(license_record.get("title"), 120)
    license_url = _safe_http_url(license_record.get("url"))
    if not name or not author or not spdx or not license_title or not license_url:
        return None

    category = _text(record.get("category"), 100)
    tags = _tags(record.get("tags"))
    return IconCollection(
        prefix=prefix,
        name=name,
        author=author,
        author_url=_safe_http_url(author_record.get("url")),
        license=IconLicense(title=license_title, spdx=spdx, url=license_url),
        category=category,
        tags=tags,
        is_brand=_looks_like_brand(prefix, name, category, tags),
    )


def normalize_search_payload(
    payload: object,
) -> tuple[list[IconCandidate], list[dict[str, str]]]:
    """Return diverse permissive candidates and bounded excluded metadata."""

    if not isinstance(payload, Mapping):
        return [], []
    record = cast(Mapping[str, Any], payload)
    raw_icons = record.get("icons")
    raw_collections = record.get("collections")
    if not isinstance(raw_icons, Sequence) or isinstance(raw_icons, (str, bytes)):
        return [], []
    if not isinstance(raw_collections, Mapping):
        return [], []

    collection_records = cast(Mapping[str, Any], raw_collections)
    allowed: dict[str, IconCollection] = {}
    excluded: list[dict[str, str]] = []
    for raw_prefix, raw_collection in collection_records.items():
        prefix = _text(raw_prefix, 96)
        normalized = _collection(prefix, raw_collection)
        if normalized is not None:
            allowed[prefix] = normalized
            continue
        if len(excluded) >= 8 or not isinstance(raw_collection, Mapping):
            continue
        metadata = cast(Mapping[str, Any], raw_collection)
        raw_license = metadata.get("license")
        license_record: Mapping[str, Any]
        if isinstance(raw_license, Mapping):
            license_record = cast(Mapping[str, Any], raw_license)
        else:
            license_record = {}
        excluded.append(
            {
                "collection": _text(metadata.get("name"), 120) or prefix,
                "prefix": prefix,
                "license": _text(license_record.get("spdx"), 64)
                or _text(license_record.get("title"), 80)
                or "unknown",
            }
        )

    # Round-robin across sets so a request for six icons does not return six
    # near-identical variants from whichever large collection ranks first.
    queues: dict[str, list[IconCandidate]] = {}
    prefix_order: list[str] = []
    seen: set[str] = set()
    for raw_icon in cast(Sequence[object], raw_icons):
        icon_id = _text(raw_icon, 200)
        if icon_id in seen or icon_id.count(":") != 1:
            continue
        prefix, name = icon_id.split(":", 1)
        collection = allowed.get(prefix)
        if collection is None:
            continue
        if not _ICON_PART.fullmatch(prefix) or not _ICON_PART.fullmatch(name):
            continue
        seen.add(icon_id)
        if prefix not in queues:
            queues[prefix] = []
            prefix_order.append(prefix)
        queues[prefix].append(IconCandidate(prefix, name, collection))

    candidates: list[IconCandidate] = []
    while prefix_order:
        remaining: list[str] = []
        for prefix in prefix_order:
            queue = queues[prefix]
            if queue:
                candidates.append(queue.pop(0))
            if queue:
                remaining.append(prefix)
        prefix_order = remaining
    return candidates, excluded


def create_iconify_client(
    transport: httpx.AsyncBaseTransport | None = None,
) -> httpx.AsyncClient:
    """A client that cannot inherit cookies, auth, proxies or redirects."""

    return httpx.AsyncClient(
        base_url=ICONIFY_API_ORIGIN,
        timeout=REQUEST_TIMEOUT_SECONDS,
        follow_redirects=False,
        trust_env=False,
        transport=transport,
        headers={"User-Agent": ICONIFY_USER_AGENT},
    )


async def _bounded_get(
    client: httpx.AsyncClient,
    path: str,
    *,
    params: Mapping[str, str] | None,
    accept: str,
    max_bytes: int,
    expected_content_type: str,
) -> bytes:
    # A response is not allowed to establish state for the next request. Clear
    # before and after so even a Set-Cookie header can never be forwarded to an
    # SVG fetch.
    client.cookies.clear()
    try:
        async with client.stream(
            "GET", path, params=params, headers={"Accept": accept}
        ) as response:
            if 300 <= response.status_code < 400:
                raise IconifyError(
                    "Iconify redirected a request; redirects are not allowed.",
                    "redirect_refused",
                )
            if response.status_code == 429:
                raise IconifyError(
                    "Iconify is rate limiting this machine. Try again later.",
                    "rate_limited",
                )
            if response.status_code == 404:
                raise IconifyError("Iconify could not find that icon.", "not_found")
            if response.status_code >= 500:
                raise IconifyError(
                    "Iconify is unavailable right now. Try again later.",
                    "provider_error",
                )
            if response.status_code >= 400:
                raise IconifyError(
                    f"Iconify rejected the request ({response.status_code}).",
                    "invalid_request",
                )

            content_type = (
                response.headers.get("content-type", "").split(";", 1)[0].lower()
            )
            if content_type != expected_content_type:
                raise IconifyError(
                    f"Iconify returned '{content_type or 'no content type'}' instead "
                    f"of '{expected_content_type}'.",
                    "bad_content_type",
                )
            declared = response.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > max_bytes:
                raise IconifyError("Iconify returned an oversized response.", "too_large")

            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > max_bytes:
                    raise IconifyError(
                        "Iconify returned an oversized response.", "too_large"
                    )
            if not body:
                raise IconifyError("Iconify returned an empty response.", "empty")
            return bytes(body)
    except IconifyError:
        raise
    except httpx.TimeoutException as error:
        raise IconifyError(
            "Iconify did not answer in time. Try again later.", "timeout"
        ) from error
    except httpx.HTTPError as error:
        raise IconifyError(
            "Could not reach Iconify. Check the network and try again.", "network"
        ) from error
    finally:
        client.cookies.clear()


async def search_icon_candidates(
    query: str, *, client: httpx.AsyncClient
) -> tuple[list[IconCandidate], list[dict[str, str]]]:
    data = await _bounded_get(
        client,
        ICONIFY_SEARCH_PATH,
        params={"query": query, "limit": str(SEARCH_CANDIDATE_LIMIT)},
        accept="application/json",
        max_bytes=MAX_SEARCH_RESPONSE_BYTES,
        expected_content_type="application/json",
    )
    try:
        payload = cast(object, json.loads(data))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise IconifyError(
            "Iconify returned search data that could not be read.", "bad_response"
        ) from error
    return normalize_search_payload(payload)


async def fetch_icon_svg(
    candidate: IconCandidate, *, client: httpx.AsyncClient
) -> bytes:
    path = f"/{quote(candidate.prefix, safe='')}/{quote(candidate.name, safe='')}.svg"
    return await _bounded_get(
        client,
        path,
        params=None,
        accept="image/svg+xml",
        max_bytes=MAX_SVG_BYTES,
        expected_content_type="image/svg+xml",
    )


__all__ = [
    "IconCandidate",
    "IconCollection",
    "IconLicense",
    "IconifyError",
    "create_iconify_client",
    "fetch_icon_svg",
    "normalize_search_payload",
    "search_icon_candidates",
]
