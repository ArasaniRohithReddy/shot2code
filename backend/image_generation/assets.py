"""One way to turn whatever an image provider returned into a usable URL.

Providers disagree about what an image *is*. Replicate answers with a public
``https://replicate.delivery/...`` URL, Cloudflare Workers AI answers with
base64 JPEG inside a JSON envelope, and an OpenAI-compatible endpoint answers
with either ``url`` or ``b64_json`` depending on the server. Without one
adapter every caller re-implements that guesswork, and the guesses differ:
that is how a ``data:`` URL ends up in a ``ToolMultimodalPart`` (which rejects
anything but a publicly fetchable URL) or an unreachable ``localhost`` URL ends
up embedded in generated HTML.

So every provider result comes through :func:`normalize_image_result` and
leaves as a :class:`NormalizedImage` with a URL that is safe to embed:

* a public ``http(s)`` URL is kept as-is - it is already fetchable by the
  model providers and by the preview;
* bytes, raw base64 and ``data:`` URLs are written to the served local asset
  directory and become a ``/local-assets/...`` URL;
* anything else - ``file:``, ``javascript:``, an SSRF-shaped host, an oversized
  payload - is rejected rather than passed along.

The bytes are kept on the result too, because a local asset URL is *not*
model-reachable: :class:`ToolMultimodalPart` needs ``data`` for those.
"""

from __future__ import annotations

import base64
import binascii
import ipaddress
import re
from dataclasses import dataclass
from typing import Any, Mapping, Sequence, cast
from urllib.parse import urlparse

from asset_urls import (
    LOCAL_ASSET_HOSTS,
    guess_image_mime,
    local_asset_url_to_bytes,
)
from image_generation.errors import ImageProviderFailure, image_failure
from uploaded_assets.store import (
    MAX_UPLOADED_ASSET_BYTES,
    SUPPORTED_IMAGE_TYPES,
    persist_data_url_as_asset,
)

# Keys providers use for the image itself, in the order we trust them. A URL is
# preferred over base64 only because it avoids a copy; both are supported.
_URL_KEYS = ("url", "image_url", "output_url", "href")
_BASE64_KEYS = ("b64_json", "image", "image_base64", "b64", "base64")
# Envelopes to look inside before giving up: Cloudflare nests under ``result``,
# the OpenAI images API under ``data``.
_ENVELOPE_KEYS = ("data", "result", "output", "images", "artifacts")

_BASE64_SHAPE = re.compile(r"^[A-Za-z0-9+/\r\n]+={0,2}$")
# Enough bytes to be a real image; short base64-looking strings are ids.
_MIN_BASE64_LENGTH = 64

# Magic numbers, so a provider's Content-Type (or its absence) never decides
# what we write to disk.
_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)


@dataclass(frozen=True)
class NormalizedImage:
    """An image that is safe to embed and safe to show a model.

    ``url`` is always embeddable. ``data`` is set when the image lives on this
    host, because such a URL is unreachable from Anthropic/OpenAI/Gemini and
    those providers must be handed bytes instead.
    """

    url: str
    mime_type: str
    data: bytes | None = None

    @property
    def is_local(self) -> bool:
        return self.data is not None


def _sniff_mime(image_bytes: bytes, fallback: str = "image/png") -> str:
    for signature, mime in _SIGNATURES:
        if image_bytes.startswith(signature):
            return mime
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return fallback if fallback in SUPPORTED_IMAGE_TYPES else "image/png"


def _is_public_http_url(url: str) -> bool:
    """Whether a URL is an ``http(s)`` address we are willing to hand onwards.

    Loopback and private/link-local literals are refused: a provider has no
    business returning one, and embedding it would either leak an internal
    address into generated markup or hand an unfetchable URL to a model.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    host = (parsed.hostname or "").lower()
    if not host or host in LOCAL_ASSET_HOSTS:
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return True
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_unspecified
    )


def _decode_base64(value: str) -> bytes | None:
    candidate = value.strip()
    if len(candidate) < _MIN_BASE64_LENGTH or not _BASE64_SHAPE.match(candidate):
        return None
    try:
        return base64.b64decode(candidate, validate=False)
    except (binascii.Error, ValueError):
        return None


def _find_url(value: Mapping[str, Any]) -> str | None:
    for key in _URL_KEYS:
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _find_base64(value: Mapping[str, Any]) -> str | None:
    for key in _BASE64_KEYS:
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _flatten(result: Any, depth: int = 0) -> tuple[str, str] | None:
    """Reduce a provider payload to ``(kind, value)`` where kind is url/base64.

    Returns ``None`` when nothing image-shaped is in there, which the caller
    turns into a failure naming the provider.
    """
    if depth > 4:
        return None

    if isinstance(result, (bytes, bytearray)):
        return ("bytes", base64.b64encode(bytes(result)).decode("ascii"))

    if isinstance(result, str):
        candidate = result.strip()
        if not candidate:
            return None
        if candidate.startswith("data:"):
            return ("data", candidate)
        if "://" in candidate[:12]:
            return ("url", candidate)
        if _decode_base64(candidate) is not None:
            return ("base64", candidate)
        return None

    if isinstance(result, Mapping):
        mapping = cast(Mapping[str, Any], result)
        url = _find_url(mapping)
        if url:
            return _flatten(url, depth + 1)
        encoded = _find_base64(mapping)
        if encoded:
            return _flatten(encoded, depth + 1)
        for key in _ENVELOPE_KEYS:
            if key in mapping:
                nested = _flatten(mapping[key], depth + 1)
                if nested:
                    return nested
        return None

    if isinstance(result, Sequence):
        for item in cast(Sequence[Any], result):
            nested = _flatten(item, depth + 1)
            if nested:
                return nested
        return None

    return None


async def persist_image_bytes(
    image_bytes: bytes,
    *,
    asset_base_url: str,
    provider: str | None = None,
    mime_hint: str = "image/png",
) -> NormalizedImage:
    """Write image bytes to the served asset directory and return its URL."""
    if not image_bytes:
        raise image_failure(
            "unknown", provider, detail="the provider returned an empty image"
        )
    if len(image_bytes) > MAX_UPLOADED_ASSET_BYTES:
        raise image_failure(
            "configuration",
            provider,
            detail=(
                f"the generated image is {len(image_bytes)} bytes, over the "
                f"{MAX_UPLOADED_ASSET_BYTES} byte limit"
            ),
        )

    mime_type = _sniff_mime(image_bytes, mime_hint)
    encoded = base64.b64encode(image_bytes).decode("ascii")
    saved = await persist_data_url_as_asset(
        f"data:{mime_type};base64,{encoded}", asset_base_url
    )
    if saved is None:
        raise image_failure(
            "unknown",
            provider,
            detail="the generated image could not be decoded as a supported image",
        )
    return NormalizedImage(
        url=saved.public_url, mime_type=saved.content_type, data=image_bytes
    )


async def normalize_image_result(
    result: Any,
    *,
    asset_base_url: str,
    provider: str | None = None,
) -> NormalizedImage:
    """Turn any provider response into an embeddable image, or raise.

    Never returns a success-shaped value with an empty URL: callers can treat a
    returned :class:`NormalizedImage` as a real image, and everything else as
    an :class:`ImageProviderFailure` to report per prompt.
    """
    flattened = _flatten(result)
    if flattened is None:
        raise image_failure(
            "unknown",
            provider,
            detail="the response contained no image URL or image data",
        )

    kind, value = flattened

    if kind == "url":
        if _is_public_http_url(value):
            return NormalizedImage(url=value, mime_type=guess_image_mime(value))
        read = local_asset_url_to_bytes(value)
        if read is not None:
            # Already one of our own served assets; keep it and carry the bytes
            # so a model can still be shown the image.
            data, content_type = read
            return NormalizedImage(url=value, mime_type=content_type, data=data)
        raise image_failure(
            "configuration",
            provider,
            detail=f"the response pointed at an unusable URL ({_describe(value)})",
        )

    if kind == "data":
        header, _, encoded = value.partition(",")
        if not encoded or not header.lower().startswith("data:image/"):
            raise image_failure(
                "unknown", provider, detail="the response held a non-image data URL"
            )
        decoded = _decode_base64(encoded) or _safe_b64(encoded)
        if decoded is None:
            raise image_failure(
                "unknown", provider, detail="the response held undecodable image data"
            )
        mime_hint = header.removeprefix("data:").split(";", 1)[0].lower()
        return await persist_image_bytes(
            decoded,
            asset_base_url=asset_base_url,
            provider=provider,
            mime_hint=mime_hint,
        )

    decoded = _decode_base64(value) or _safe_b64(value)
    if decoded is None:
        raise image_failure(
            "unknown", provider, detail="the response held undecodable image data"
        )
    return await persist_image_bytes(
        decoded, asset_base_url=asset_base_url, provider=provider
    )


def _safe_b64(value: str) -> bytes | None:
    try:
        return base64.b64decode(value, validate=False)
    except (binascii.Error, ValueError):
        return None


def _describe(url: str) -> str:
    """A URL's shape without its path, so nothing sensitive is echoed."""
    parsed = urlparse(url)
    scheme = parsed.scheme or "?"
    host = parsed.hostname or "?"
    return f"{scheme}://{host}"


async def resolve_image_bytes(
    image_url: str, *, provider: str | None = None
) -> tuple[bytes, str]:
    """Read any image URL we are allowed to read into ``(bytes, mime_type)``.

    The OpenAI images *edits* route is multipart and takes a file, so a URL has
    to be resolved first. Only the three sources we trust are accepted: one of
    our own served assets, a ``data:`` URL, and a public ``http(s)`` URL. A
    private or loopback address that is not one of our assets is refused rather
    than fetched, so this cannot be turned into an SSRF primitive by a model
    that invents a URL.
    """
    read = local_asset_url_to_bytes(image_url)
    if read is not None:
        return read

    if image_url.startswith("data:"):
        header, _, encoded = image_url.partition(",")
        decoded = _safe_b64(encoded) if encoded else None
        if decoded is None:
            raise image_failure(
                "configuration", provider, detail="undecodable data URL input"
            )
        mime = header.removeprefix("data:").split(";", 1)[0].lower() or "image/png"
        return decoded, _sniff_mime(decoded, mime)

    if not _is_public_http_url(image_url):
        raise image_failure(
            "configuration",
            provider,
            detail=f"refusing to fetch {_describe(image_url)} as an image input",
        )

    import httpx

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(image_url)
    if response.status_code >= 400:
        raise image_failure(
            "configuration",
            provider,
            detail=f"the source image could not be read ({response.status_code})",
        )
    content = response.content
    header_mime = (response.headers.get("content-type") or "").split(";", 1)[0].lower()
    return content, _sniff_mime(content, header_mime or "image/png")


__all__ = [
    "NormalizedImage",
    "ImageProviderFailure",
    "normalize_image_result",
    "persist_image_bytes",
    "resolve_image_bytes",
]
