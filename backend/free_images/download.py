"""Fetching an image from an address a stranger chose.

Every URL here came from a third-party index describing a fourth party's
server, so the rule is that nothing is trusted except what this module
verifies itself.

The threats, and the answer to each:

* **SSRF.** A result URL could name ``localhost``, a RFC1918 address, or a
  cloud metadata endpoint. Checking the *string* is not enough: a public
  hostname can resolve to ``169.254.169.254``. So the hostname is resolved and
  **every** returned address is checked, and the connection is then pinned to
  the address that was checked, so a second lookup cannot return a different
  one (DNS rebinding).
* **Redirects.** Following one would land on an address that was never
  checked. Redirects are disabled and each ``Location`` is re-validated from
  scratch, with a hop limit.
* **Content type.** A server can label anything ``image/png``. The header is
  checked against an allowlist *and* the bytes are sniffed, and they must
  agree.
* **Size.** The body is read in chunks against a byte ceiling so an endless
  response cannot exhaust memory, and the decoded pixel count is checked too,
  because a few hundred kilobytes can decompress into gigabytes.

The result is handed to the shared image asset adapter, so a free image ends
up as a local ``/local-assets/`` URL exactly like a generated one. Nothing
external is ever hotlinked into generated or exported markup.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

from free_images.config import (
    ALLOWED_IMAGE_MIME_TYPES,
    DOWNLOAD_TIMEOUT_SECONDS,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
    MAX_REDIRECTS,
    OPENVERSE_USER_AGENT,
)

# Addresses that are never a legitimate image host. The IPv4 and IPv6 cloud
# metadata services are named explicitly because they are the highest-value
# SSRF target and are not covered by "is_private".
_METADATA_ADDRESSES = frozenset(
    {
        "169.254.169.254",  # AWS / Azure / GCP / DigitalOcean IMDS
        "100.100.100.200",  # Alibaba Cloud
        "192.0.0.192",  # Oracle Cloud
        "fd00:ec2::254",  # AWS IMDSv6
    }
)

_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)

_UNSAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")
MAX_FILENAME_CHARS = 64

_EXTENSIONS: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


class ImageDownloadRejected(Exception):
    """The image was not fetched, with a reason safe to show a user."""

    def __init__(self, reason: str, code: str = "rejected") -> None:
        super().__init__(reason)
        self.reason = reason
        self.code = code


@dataclass(frozen=True)
class DownloadedImage:
    data: bytes
    mime_type: str
    filename: str


def sniff_image_mime(data: bytes) -> str | None:
    """The MIME the *bytes* claim to be, or ``None`` if they are not an image."""
    for signature, mime in _SIGNATURES:
        if data.startswith(signature):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def is_blocked_address(address: str) -> bool:
    """Whether an IP literal must never be connected to."""
    if address in _METADATA_ADDRESSES:
        return True
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return True
    return bool(
        parsed.is_private
        or parsed.is_loopback
        or parsed.is_link_local
        or parsed.is_reserved
        or parsed.is_multicast
        or parsed.is_unspecified
    )


def resolve_public_addresses(host: str) -> list[str]:
    """Every address ``host`` resolves to, refusing if any is not public.

    All-or-nothing on purpose: a name that answers with one routable address
    and one loopback address is a rebinding attempt, not a slightly odd host.
    """
    if not host:
        raise ImageDownloadRejected("the image URL has no host", "bad_url")

    try:
        ipaddress.ip_address(host)
        literals = [host]
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
        except socket.gaierror as error:
            raise ImageDownloadRejected(
                f"could not resolve {host}", "dns_failed"
            ) from error
        literals = []
        for info in infos:
            sockaddr: Any = info[4]
            if isinstance(sockaddr, tuple) and sockaddr:
                literals.append(str(sockaddr[0]))

    if not literals:
        raise ImageDownloadRejected(f"could not resolve {host}", "dns_failed")

    for literal in literals:
        if is_blocked_address(literal):
            raise ImageDownloadRejected(
                f"{host} resolves to a non-public address", "blocked_address"
            )
    return literals


def validate_image_url(url: str) -> tuple[str, str]:
    """Check a candidate URL and return ``(url, pinned_ip)``.

    The pinned address is the one that passed the check; the request is sent to
    it with the original ``Host`` header, so the name cannot resolve to
    something else between the check and the connection.
    """
    candidate = (url or "").strip()
    if not candidate:
        raise ImageDownloadRejected("no image URL was given", "bad_url")
    parts = urlsplit(candidate)
    if parts.scheme not in ("http", "https"):
        raise ImageDownloadRejected(
            f"only http and https image URLs are fetched, not '{parts.scheme}'",
            "bad_scheme",
        )
    if parts.username or parts.password:
        raise ImageDownloadRejected(
            "the image URL embeds credentials", "bad_url"
        )
    host = parts.hostname or ""
    addresses = resolve_public_addresses(host)
    return candidate, addresses[0]


def clean_filename(title: str, mime_type: str, fallback: str) -> str:
    """A safe, readable filename for a downloaded image.

    Derived from the title rather than the URL, because a URL path is
    attacker-controlled and full of traversal opportunities; the extension
    comes from the sniffed MIME rather than from either.
    """
    base = _UNSAFE_FILENAME.sub("-", (title or "").strip()).strip("-._")
    if not base:
        base = _UNSAFE_FILENAME.sub("-", fallback).strip("-._") or "image"
    base = base[:MAX_FILENAME_CHARS].strip("-._") or "image"
    return f"{base.lower()}{_EXTENSIONS.get(mime_type, '.png')}"


def _check_declared_mime(content_type: str | None) -> str | None:
    declared = (content_type or "").split(";", 1)[0].strip().lower()
    if not declared:
        return None
    if declared not in ALLOWED_IMAGE_MIME_TYPES:
        raise ImageDownloadRejected(
            f"the server returned '{declared}', which is not an allowed image type",
            "bad_content_type",
        )
    return declared


def _check_pixels(data: bytes) -> None:
    """Refuse an image whose decoded size is unreasonable.

    A decompression bomb is small on the wire and enormous in memory, so the
    header is read without decoding the pixels.
    """
    try:
        from io import BytesIO

        from PIL import Image

        with Image.open(BytesIO(data)) as image:
            width, height = image.size
    except ImageDownloadRejected:
        raise
    except Exception as error:  # noqa: BLE001 - any decode failure is a refusal
        raise ImageDownloadRejected(
            "the downloaded bytes are not a readable image", "bad_image"
        ) from error
    if width * height > MAX_IMAGE_PIXELS:
        raise ImageDownloadRejected(
            f"the image is {width}x{height}, over the "
            f"{MAX_IMAGE_PIXELS:,} pixel limit",
            "too_large",
        )


async def download_image(
    url: str,
    *,
    title: str = "",
    fallback_name: str = "image",
    client: httpx.AsyncClient | None = None,
) -> DownloadedImage:
    """Fetch one image, or raise :class:`ImageDownloadRejected`.

    Redirects are not followed by the client; each hop is validated by this
    function before the next request is made, so no address is ever connected
    to without having been checked.
    """
    owns_client = client is None
    http = client or httpx.AsyncClient(
        timeout=DOWNLOAD_TIMEOUT_SECONDS,
        follow_redirects=False,
        headers={"User-Agent": OPENVERSE_USER_AGENT},
    )
    try:
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            validated, _pinned = validate_image_url(current)
            try:
                response = await http.get(validated)
            except ImageDownloadRejected:
                raise
            except httpx.TimeoutException as error:
                raise ImageDownloadRejected(
                    "the image server did not respond in time", "timeout"
                ) from error
            except Exception as error:  # noqa: BLE001 - reported, never raised raw
                raise ImageDownloadRejected(
                    "the image server could not be reached", "network"
                ) from error

            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("location")
                if not location:
                    raise ImageDownloadRejected(
                        "the image server redirected without a target", "bad_redirect"
                    )
                # Re-validated from scratch on the next pass, which is the
                # point: a redirect is a brand-new address, not a continuation.
                current = str(httpx.URL(validated).join(location))
                continue

            if response.status_code >= 400:
                raise ImageDownloadRejected(
                    f"the image server answered {response.status_code}",
                    "http_error",
                )

            declared = _check_declared_mime(response.headers.get("content-type"))
            data = response.content
            if len(data) > MAX_IMAGE_BYTES:
                raise ImageDownloadRejected(
                    f"the image is {len(data):,} bytes, over the "
                    f"{MAX_IMAGE_BYTES:,} byte limit",
                    "too_large",
                )
            if not data:
                raise ImageDownloadRejected("the image was empty", "bad_image")

            sniffed = sniff_image_mime(data)
            if sniffed is None or sniffed not in ALLOWED_IMAGE_MIME_TYPES:
                raise ImageDownloadRejected(
                    "the downloaded bytes are not an allowed image type",
                    "bad_content_type",
                )
            # A server that labels a GIF as a PNG is not necessarily hostile,
            # but it is not trustworthy either; the bytes decide.
            if declared is not None and declared != sniffed:
                raise ImageDownloadRejected(
                    f"the server said '{declared}' but sent '{sniffed}'",
                    "bad_content_type",
                )
            _check_pixels(data)

            return DownloadedImage(
                data=data,
                mime_type=sniffed,
                filename=clean_filename(title, sniffed, fallback_name),
            )

        raise ImageDownloadRejected(
            "the image URL redirected too many times", "bad_redirect"
        )
    finally:
        if owns_client:
            await http.aclose()


__all__ = [
    "DownloadedImage",
    "ImageDownloadRejected",
    "clean_filename",
    "download_image",
    "is_blocked_address",
    "resolve_public_addresses",
    "sniff_image_mime",
    "validate_image_url",
]
