"""The Openverse image search client, and nothing else.

One fixed endpoint, one request per call, no credential. The URL is a module
constant rather than a parameter on purpose: a caller-supplied search host
would turn this tool into an open proxy wearing a trustworthy name.

Normalisation is strict in one direction. Openverse returns the whole
Creative Commons spectrum even when asked for a subset, so every result is
re-checked here against the allowed licences before it is returned - the
server's filter is treated as a hint, not as the enforcement. A result missing
the metadata a user would need to verify it (source page, licence URL) is
dropped for the same reason: passing it on would imply shot2code had checked
something it had not.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence, cast
from urllib.parse import urlsplit

import httpx

from free_images.config import (
    ALLOWED_LICENSE_PARAM,
    MAX_CREATOR_CHARS,
    MAX_QUERY_CHARS,
    MAX_TITLE_CHARS,
    OPENVERSE_ASPECT_RATIO,
    OPENVERSE_IMAGE_SEARCH_URL,
    OPENVERSE_USER_AGENT,
    SEARCH_PAGE_SIZE,
    SEARCH_TIMEOUT_SECONDS,
    is_allowed_license,
    license_label,
)


class OpenverseError(Exception):
    """A search that did not produce results, with an actionable reason."""

    def __init__(self, message: str, code: str = "provider_error") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass(frozen=True)
class FreeImageResult:
    """One CC0/public-domain image, with everything needed to verify it."""

    id: str
    title: str
    creator: str
    image_url: str
    source_page_url: str
    provider: str
    license_code: str
    license_name: str
    license_url: str
    width: int | None = None
    height: int | None = None
    thumbnail_url: str | None = None
    attribution: str = ""

    def to_metadata(self) -> dict[str, Any]:
        """The credit block that travels with the image everywhere it goes."""
        payload: dict[str, Any] = {
            "id": self.id,
            "title": self.title,
            "creator": self.creator,
            "source_page": self.source_page_url,
            "provider": self.provider,
            "license": self.license_code,
            "license_name": self.license_name,
            "license_url": self.license_url,
        }
        if self.width and self.height:
            payload["width"] = self.width
            payload["height"] = self.height
        if self.attribution:
            payload["attribution"] = self.attribution
        return payload


def _text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    collapsed = " ".join(value.split())
    return collapsed[:limit]


def _https_url(value: object) -> str:
    """A URL we are willing to show or fetch, or ``""``.

    Scheme-checked here as well as at download time, so a ``javascript:`` or
    ``data:`` value can never even reach the activity feed.
    """
    if not isinstance(value, str) or not value.strip():
        return ""
    candidate = value.strip()
    parts = urlsplit(candidate)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return ""
    return candidate


def _dimension(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = int(value)
    return number if number > 0 else None


def normalize_result(raw: object) -> FreeImageResult | None:
    """One Openverse record as a result, or ``None`` if it cannot be trusted.

    Dropped rather than repaired: a record with no source page or no licence
    URL cannot be verified by the user, and this tool's whole promise is that
    it can be.
    """
    if not isinstance(raw, Mapping):
        return None
    record = cast(Mapping[str, Any], raw)

    license_code = _text(record.get("license"), 32).lower()
    # The server was asked for cc0/pdm; this is the check that makes it true.
    if not is_allowed_license(license_code):
        return None

    image_url = _https_url(record.get("url"))
    source_page = _https_url(record.get("foreign_landing_url"))
    license_url = _https_url(record.get("license_url"))
    if not image_url or not source_page or not license_url:
        return None

    identifier = _text(record.get("id"), 64)
    if not identifier:
        return None

    return FreeImageResult(
        id=identifier,
        title=_text(record.get("title"), MAX_TITLE_CHARS) or "Untitled",
        creator=_text(record.get("creator"), MAX_CREATOR_CHARS) or "Unknown",
        image_url=image_url,
        source_page_url=source_page,
        provider=_text(record.get("provider") or record.get("source"), 48) or "unknown",
        license_code=license_code,
        license_name=license_label(license_code),
        license_url=license_url,
        width=_dimension(record.get("width")),
        height=_dimension(record.get("height")),
        thumbnail_url=_https_url(record.get("thumbnail")) or None,
        attribution=_text(record.get("attribution"), 320),
    )


def normalize_results(payload: object) -> list[FreeImageResult]:
    """Every usable result in an Openverse response, in its own order."""
    if not isinstance(payload, Mapping):
        return []
    raw_results = cast(Mapping[str, Any], payload).get("results")
    if not isinstance(raw_results, Sequence) or isinstance(raw_results, (str, bytes)):
        return []
    results: list[FreeImageResult] = []
    seen: set[str] = set()
    for item in cast(Sequence[Any], raw_results):
        result = normalize_result(item)
        if result is None or result.id in seen:
            continue
        seen.add(result.id)
        results.append(result)
    return results


def build_search_params(
    query: str, *, orientation: str = "any", page_size: int = SEARCH_PAGE_SIZE
) -> dict[str, str]:
    """The query string sent to Openverse.

    ``license`` is always present and always the allowed set: there is no code
    path that asks Openverse for an attribution or share-alike licence.
    """
    params: dict[str, str] = {
        "q": query[:MAX_QUERY_CHARS],
        "license": ALLOWED_LICENSE_PARAM,
        "page_size": str(max(1, min(page_size, 20))),
        # Openverse's own safety filter; shot2code has no reason to switch it
        # off on a user's behalf.
        "mature": "false",
    }
    aspect_ratio = OPENVERSE_ASPECT_RATIO.get(orientation)
    if aspect_ratio:
        params["aspect_ratio"] = aspect_ratio
    return params


def _retry_after_hint(response: httpx.Response) -> str:
    """Turn a 429 into advice rather than a status code.

    Openverse's anonymous allowance is a small per-minute burst on top of a
    daily total, so "wait N seconds" is usually literally the fix.
    """
    raw = response.headers.get("retry-after", "").strip()
    if raw.isdigit():
        seconds = int(raw)
        if seconds > 0:
            return f" Try again in about {min(seconds, 3600)} seconds."
    remaining = response.headers.get("x-ratelimit-available-anon_sustained")
    if remaining == "0":
        return (
            " The anonymous daily allowance for this machine is used up; it "
            "resets tomorrow."
        )
    return " Wait a moment before searching again."


async def search_images(
    query: str,
    *,
    orientation: str = "any",
    page_size: int = SEARCH_PAGE_SIZE,
    client: httpx.AsyncClient | None = None,
) -> list[FreeImageResult]:
    """Run exactly one Openverse search and normalise what comes back."""
    owns_client = client is None
    http = client or httpx.AsyncClient(
        timeout=SEARCH_TIMEOUT_SECONDS,
        follow_redirects=False,
        headers={"User-Agent": OPENVERSE_USER_AGENT},
    )
    try:
        response = await http.get(
            OPENVERSE_IMAGE_SEARCH_URL,
            params=build_search_params(
                query, orientation=orientation, page_size=page_size
            ),
        )
    except httpx.TimeoutException as error:
        raise OpenverseError(
            "Openverse did not answer in time. Try again in a moment.", "timeout"
        ) from error
    except Exception as error:  # noqa: BLE001 - reported, never raised raw
        raise OpenverseError(
            "Could not reach the Openverse image search. Check the network "
            "connection and try again.",
            "network",
        ) from error
    finally:
        if owns_client:
            await http.aclose()

    if response.status_code == 429:
        raise OpenverseError(
            "Openverse is rate limiting this machine." + _retry_after_hint(response),
            "rate_limited",
        )
    if response.status_code == 400:
        raise OpenverseError(
            "Openverse rejected that search. Try a simpler query.",
            "invalid_request",
        )
    if response.status_code >= 500:
        raise OpenverseError(
            "Openverse is having trouble right now. Try again shortly.",
            "provider_error",
        )
    if response.status_code >= 400:
        raise OpenverseError(
            f"Openverse answered {response.status_code}.", "provider_error"
        )

    try:
        payload = cast(Any, response.json())
    except ValueError as error:
        raise OpenverseError(
            "Openverse returned a response that could not be read.",
            "provider_error",
        ) from error

    return normalize_results(payload)


__all__ = [
    "FreeImageResult",
    "OpenverseError",
    "build_search_params",
    "normalize_result",
    "normalize_results",
    "search_images",
]
