"""Policy and limits for the canonical ``search_icons`` tool."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, cast

ICONIFY_API_ORIGIN = "https://api.iconify.design"
ICONIFY_SEARCH_PATH = "/search"
ICONIFY_DOCS_URL = "https://iconify.design/docs/api/"
ICONIFY_ICON_SETS_URL = "https://icon-sets.iconify.design/"
ICONIFY_USER_AGENT = (
    "shot2code/1.0 (+https://github.com/ArasaniRohithReddy/shot2code)"
)

MIN_QUERY_CHARS = 2
MAX_QUERY_CHARS = 100
MIN_ICONS = 1
MAX_ICONS = 6
DEFAULT_ICONS = 4

# Iconify rounds small search limits up to 32, so request that minimum and
# bound/filter the response locally.
SEARCH_CANDIDATE_LIMIT = 32
MAX_ICON_DOWNLOAD_ATTEMPTS = 12
MAX_SEARCH_RESPONSE_BYTES = 256 * 1024
MAX_SVG_BYTES = 128 * 1024
MAX_SVG_CHARS = 200_000
MAX_SANITIZED_SVG_BYTES = 160 * 1024
MAX_SVG_ELEMENTS = 2_048
MAX_SVG_ATTRIBUTES = 8_192
REQUEST_TIMEOUT_SECONDS = 12.0

# Redirects are unsupported. Every response must therefore come from the one
# fixed origin and no redirected hostname needs a second trust decision.
MAX_REDIRECTS = 0

MAX_SEARCHES_PER_TURN = 3
MAX_SEARCHES_PER_GENERATION = 10

# Suitable for automatic import when provenance remains embedded in the SVG.
# Unknown, copyleft, attribution-only, share-alike and non-commercial licences
# are excluded.
PERMISSIVE_LICENSES: tuple[str, ...] = (
    "0BSD",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "BSL-1.0",
    "CC0-1.0",
    "ISC",
    "MIT",
    "Unlicense",
    "Zlib",
)
_LICENSE_LOOKUP = {
    license_id.lower(): license_id for license_id in PERMISSIVE_LICENSES
}

ACCESS_CHECKED = "2026-10-04"
ACCESS_NOTE = (
    "Iconify's public API currently accepts requests without an account or API "
    f"key (checked {ACCESS_CHECKED}). Iconify does not publish a fixed public "
    "quota for this service, so its limits and availability are controlled by "
    "Iconify and can change."
)

EGRESS_NOTICE = (
    "The icon query is sent only to api.iconify.design. Selected SVGs are "
    "downloaded from that same fixed origin without cookies, authorization or "
    "any shot2code credential, sanitized, and saved on this machine."
)

THIRD_PARTY_METADATA_WARNING = (
    "Iconify aggregates icon-set metadata supplied by upstream projects. Treat "
    "collection names, authors and licence details as third-party metadata and "
    "verify the linked source before shipping a high-risk or commercial use."
)

TRADEMARK_WARNING = (
    "Icons can depict company names, products or logos. A permissive copyright "
    "licence does not grant trademark rights or imply endorsement; verify brand "
    "guidelines before using a brand icon."
)


def normalize_spdx(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return _LICENSE_LOOKUP.get(value.strip().lower(), "")


def is_permissive_license(value: object) -> bool:
    return bool(normalize_spdx(value))


@dataclass(frozen=True)
class IconSearchSettings:
    """Whether Iconify search is offered to models for this run."""

    enabled: bool = False

    @property
    def is_usable(self) -> bool:
        return self.enabled

    @property
    def unusable_reason(self) -> str | None:
        if self.enabled:
            return None
        return (
            "Icon search is switched off. Enable the Iconify design add-on in "
            "Settings to let the model find and localize SVG icons."
        )

    def describe(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "provider": "iconify",
            "origin": ICONIFY_API_ORIGIN,
            "permissiveLicenses": list(PERMISSIVE_LICENSES),
        }


EMPTY_ICON_SEARCH = IconSearchSettings()


class IconSearchConfigError(ValueError):
    """A malformed ``iconSearch`` request block."""


def parse_icon_search_settings(params: object) -> IconSearchSettings:
    """Read the explicit opt-in; absent means off for older clients."""

    if not isinstance(params, Mapping):
        return EMPTY_ICON_SEARCH
    mapping = cast(Mapping[str, Any], params)
    raw = mapping.get("iconSearch")
    if raw is None:
        return EMPTY_ICON_SEARCH
    if not isinstance(raw, Mapping):
        raise IconSearchConfigError("iconSearch must be an object.")
    block = cast(Mapping[str, Any], raw)
    enabled = block.get("enabled")
    if enabled is not None and not isinstance(enabled, bool):
        raise IconSearchConfigError("iconSearch.enabled must be true or false.")
    return IconSearchSettings(enabled=bool(enabled))


__all__ = [
    "ACCESS_CHECKED",
    "ACCESS_NOTE",
    "DEFAULT_ICONS",
    "EGRESS_NOTICE",
    "EMPTY_ICON_SEARCH",
    "ICONIFY_API_ORIGIN",
    "ICONIFY_DOCS_URL",
    "ICONIFY_ICON_SETS_URL",
    "ICONIFY_SEARCH_PATH",
    "ICONIFY_USER_AGENT",
    "IconSearchConfigError",
    "IconSearchSettings",
    "MAX_ICON_DOWNLOAD_ATTEMPTS",
    "MAX_ICONS",
    "MAX_QUERY_CHARS",
    "MAX_REDIRECTS",
    "MAX_SANITIZED_SVG_BYTES",
    "MAX_SEARCHES_PER_GENERATION",
    "MAX_SEARCHES_PER_TURN",
    "MAX_SEARCH_RESPONSE_BYTES",
    "MAX_SVG_ATTRIBUTES",
    "MAX_SVG_BYTES",
    "MAX_SVG_CHARS",
    "MAX_SVG_ELEMENTS",
    "MIN_ICONS",
    "MIN_QUERY_CHARS",
    "PERMISSIVE_LICENSES",
    "REQUEST_TIMEOUT_SECONDS",
    "SEARCH_CANDIDATE_LIMIT",
    "THIRD_PARTY_METADATA_WARNING",
    "TRADEMARK_WARNING",
    "is_permissive_license",
    "normalize_spdx",
    "parse_icon_search_settings",
]
