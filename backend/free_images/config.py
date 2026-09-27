"""What ``search_free_images`` is allowed to do, and why the limits are these.

No credential lives here, which is the point: Openverse's image search is a
public, keyless endpoint, so this is the one image path that works on a machine
with no Replicate, Cloudflare or OpenAI-compatible configuration at all. It is
*additive* - having those credentials does not turn it off, and it never
re-routes ``generate_images``. The two answer different questions: one invents
a picture, this one finds a real photograph somebody has already released.

The licence filter is the load-bearing rule. Openverse indexes the whole
Creative Commons spectrum, and most of it carries obligations an exported
project would silently inherit: BY needs attribution wherever the image
appears, SA infects the work it is combined with, NC forbids commercial use,
ND forbids cropping or recolouring. shot2code cannot enforce any of that in
someone else's codebase, so the first release returns **only** CC0 and the
Public Domain Mark, where there is nothing to inherit. The metadata still
travels with every result, because Openverse aggregates other people's
metadata and can be wrong about it - a user who is about to ship commercially
has to check the source page, and is told so.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Mapping, cast

# The one endpoint this package talks to. Fixed, HTTPS, no credential, and
# never taken from a request: a caller-supplied search host would be an open
# proxy wearing this tool's name.
OPENVERSE_API_BASE_URL = "https://api.openverse.org/v1"
OPENVERSE_IMAGE_SEARCH_URL = f"{OPENVERSE_API_BASE_URL}/images/"

OPENVERSE_TERMS_URL = "https://openverse.org/terms"
OPENVERSE_API_DOCS_URL = "https://api.openverse.org/v1/"
OPENVERSE_SEARCH_DOCS_URL = "https://docs.openverse.org/api/reference/made_with_ov.html"

# Sent so Openverse can identify the traffic; it carries no user information.
OPENVERSE_USER_AGENT = "shot2code/1.0 (+https://github.com/ArasaniRohithReddy/shot2code)"

# Licences whose only obligation is "nothing". Anything else - by, by-sa,
# by-nc, by-nd and their combinations - would hand an exported project an
# obligation shot2code cannot honour on the user's behalf.
FreeLicense = Literal["cc0", "pdm"]
ALLOWED_LICENSES: tuple[FreeLicense, ...] = ("cc0", "pdm")
ALLOWED_LICENSE_PARAM = ",".join(ALLOWED_LICENSES)

LICENSE_LABELS: dict[str, str] = {
    "cc0": "CC0 1.0 (public domain dedication)",
    "pdm": "Public Domain Mark 1.0",
}

# Openverse's own vocabulary is wide/tall/square. The tool exposes the words a
# designer uses and maps them, so a model asking for "landscape" is not met
# with a 400 from an API it never sees.
Orientation = Literal["landscape", "portrait", "square", "any"]
ORIENTATION_VALUES: tuple[Orientation, ...] = (
    "any",
    "landscape",
    "portrait",
    "square",
)
OPENVERSE_ASPECT_RATIO: dict[str, str] = {
    "landscape": "wide",
    "portrait": "tall",
    "square": "square",
}

MIN_QUERY_CHARS = 2
MAX_QUERY_CHARS = 200
MIN_IMAGES = 1
MAX_IMAGES = 4
DEFAULT_IMAGES = 2

# Openverse's anonymous allowance is 20 requests a minute and 200 a day, so a
# run that hammered it would break the feature for the user's whole day. One
# request per call, and the same per-turn/per-generation shape the web-search
# tool already uses.
MAX_SEARCHES_PER_TURN = 3
MAX_SEARCHES_PER_GENERATION = 10

SEARCH_TIMEOUT_SECONDS = 12.0
DOWNLOAD_TIMEOUT_SECONDS = 20.0

# Openverse is asked for more than the model wanted, because a result can be
# dropped on the way: an unsafe URL, a wrong content type, an oversized file.
# Over-fetching lets the batch still fill instead of silently under-delivering.
SEARCH_PAGE_SIZE = 12

MAX_TITLE_CHARS = 160
MAX_CREATOR_CHARS = 120

# Caps for a downloaded image. Bytes bound the transfer, pixels bound what a
# decoder is asked to do (a small file can decompress to an enormous bitmap),
# and the count is the model's own request.
MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_REDIRECTS = 2

ALLOWED_IMAGE_MIME_TYPES: frozenset[str] = frozenset(
    {"image/jpeg", "image/png", "image/gif", "image/webp"}
)

# Said in the payload, in the activity feed and in Settings. Openverse
# aggregates other services' metadata and is explicit that it can be wrong, so
# "it said CC0" is not a licence audit.
VERIFY_METADATA_WARNING = (
    "Openverse aggregates licence metadata from other platforms and can be "
    "wrong. Before using any of these images commercially, open the source "
    "page and confirm the licence and the creator yourself."
)

EGRESS_NOTICE = (
    "Your search text is sent to the Openverse API (api.openverse.org), and "
    "the images you keep are downloaded from the sites Openverse indexes. "
    "shot2code adds no charge of its own and sends no credential."
)

# What Openverse's API currently costs and requires, hedged like every other
# provider in this codebase. Verified against the live API: the search endpoint
# answers anonymous requests, and its own rate-limit headers advertise roughly
# 20 requests a minute and 200 a day for an unauthenticated caller. That is
# Openverse's allowance on Openverse's terms - attributed, scoped, and able to
# change - not a permanent free tier shot2code can promise.
OPENVERSE_ACCESS_CHECKED = "2026-09-27"

OPENVERSE_ACCESS_NOTE = (
    "Openverse's image search currently answers requests without an API key "
    f"or an account (checked {OPENVERSE_ACCESS_CHECKED}), within the anonymous "
    "rate limits it publishes - around 20 requests a minute and 200 a day per "
    "machine. Those limits, and keyless access itself, are set by Openverse "
    "and can change."
)


@dataclass(frozen=True)
class FreeImageSearchSettings:
    """Whether the tool is offered. There is nothing else to configure.

    Off by default: it is an explicit opt-in because it sends the model's query
    to a third party, and no existing shot2code policy makes an unrequested
    network call acceptable on a user's behalf.
    """

    enabled: bool = False

    @property
    def is_usable(self) -> bool:
        # No credential to check - that is the whole feature. The only reason
        # this could be unusable is the user not having asked for it.
        return self.enabled

    @property
    def unusable_reason(self) -> str | None:
        if self.enabled:
            return None
        return (
            "Free image search is switched off. Enable it in Settings under "
            "Free image search to let the model find public-domain photos."
        )

    def describe(self) -> dict[str, Any]:
        """A description safe to log or stream; there is no secret to omit."""
        return {
            "enabled": self.enabled,
            "provider": "openverse",
            "licenses": list(ALLOWED_LICENSES),
        }


EMPTY_FREE_IMAGE_SEARCH = FreeImageSearchSettings()


class FreeImageConfigError(ValueError):
    """A malformed ``freeImageSearch`` block in a generation request."""


def parse_free_image_settings(params: object) -> FreeImageSearchSettings:
    """Read the opt-in out of a generation request.

    Absent means off, so an older client - or one that never heard of this
    feature - behaves exactly as it did before.
    """
    if not isinstance(params, Mapping):
        return EMPTY_FREE_IMAGE_SEARCH
    mapping = cast(Mapping[str, Any], params)
    raw = mapping.get("freeImageSearch")
    if raw is None:
        return EMPTY_FREE_IMAGE_SEARCH
    if not isinstance(raw, Mapping):
        raise FreeImageConfigError("freeImageSearch must be an object.")
    block = cast(Mapping[str, Any], raw)
    enabled = block.get("enabled")
    if enabled is not None and not isinstance(enabled, bool):
        raise FreeImageConfigError("freeImageSearch.enabled must be true or false.")
    return FreeImageSearchSettings(enabled=bool(enabled))


def license_label(code: str) -> str:
    """A human licence name for a code Openverse returned."""
    normalized = (code or "").strip().lower()
    return LICENSE_LABELS.get(normalized, normalized.upper() or "Unknown")


def is_allowed_license(code: object) -> bool:
    """Whether a result's licence carries no obligation to inherit."""
    return isinstance(code, str) and code.strip().lower() in ALLOWED_LICENSES


__all__ = [
    "ALLOWED_IMAGE_MIME_TYPES",
    "ALLOWED_LICENSES",
    "ALLOWED_LICENSE_PARAM",
    "DEFAULT_IMAGES",
    "DOWNLOAD_TIMEOUT_SECONDS",
    "EGRESS_NOTICE",
    "EMPTY_FREE_IMAGE_SEARCH",
    "FreeImageConfigError",
    "FreeImageSearchSettings",
    "FreeLicense",
    "LICENSE_LABELS",
    "MAX_IMAGE_BYTES",
    "MAX_IMAGE_PIXELS",
    "MAX_IMAGES",
    "MAX_QUERY_CHARS",
    "MAX_REDIRECTS",
    "MAX_SEARCHES_PER_GENERATION",
    "MAX_SEARCHES_PER_TURN",
    "MIN_IMAGES",
    "MIN_QUERY_CHARS",
    "OPENVERSE_ACCESS_CHECKED",
    "OPENVERSE_ACCESS_NOTE",
    "OPENVERSE_API_DOCS_URL",
    "OPENVERSE_ASPECT_RATIO",
    "OPENVERSE_IMAGE_SEARCH_URL",
    "OPENVERSE_SEARCH_DOCS_URL",
    "OPENVERSE_TERMS_URL",
    "OPENVERSE_USER_AGENT",
    "ORIENTATION_VALUES",
    "Orientation",
    "SEARCH_PAGE_SIZE",
    "SEARCH_TIMEOUT_SECONDS",
    "VERIFY_METADATA_WARNING",
    "is_allowed_license",
    "license_label",
    "parse_free_image_settings",
]
