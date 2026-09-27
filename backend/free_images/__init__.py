"""Keyless, licence-aware free image search for shot2code.

One canonical tool, ``search_free_images``, offered to *every* runtime through
the existing canonical tool serialization - native OpenAI, native Anthropic,
native Gemini, a Copilot subscription session and a Copilot SDK BYOK session
all reach the same shot2code-owned implementation.

It is **additive and credential-free**. It is the only image path that works on
a machine with no Replicate, Cloudflare or OpenAI-compatible configuration, and
configuring those changes nothing about it. It never re-routes
``generate_images``: the two are separate tools for separate jobs, and the
model picks.

The pieces:

* :mod:`free_images.config` - the opt-in, the bounds, and the licence policy.
  CC0 and the Public Domain Mark only, so an exported project cannot inherit
  an attribution, share-alike or non-commercial obligation.
* :mod:`free_images.openverse` - one fixed, keyless endpoint, one request per
  call, and normalisation that re-checks the licence itself rather than
  trusting the server's filter.
* :mod:`free_images.download` - the hostile-input boundary: DNS resolution and
  private/metadata address rejection, no followed redirects, a MIME allowlist
  checked against sniffed bytes, and byte and pixel ceilings.
* :mod:`free_images.tool` - the tool definition, the budgets, and a response
  that carries the credit metadata and the "verify before commercial use"
  warning.

Web search is deliberately *not* involved. A web image result is a picture
somebody put on a page; it grants no reuse right, and presenting one as usable
would be the single most damaging thing this feature could do.
"""

from free_images.config import (
    ALLOWED_IMAGE_MIME_TYPES,
    ALLOWED_LICENSES,
    DEFAULT_IMAGES,
    EGRESS_NOTICE,
    EMPTY_FREE_IMAGE_SEARCH,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
    MAX_IMAGES,
    MAX_QUERY_CHARS,
    MAX_SEARCHES_PER_GENERATION,
    MAX_SEARCHES_PER_TURN,
    MIN_IMAGES,
    MIN_QUERY_CHARS,
    OPENVERSE_IMAGE_SEARCH_URL,
    OPENVERSE_TERMS_URL,
    ORIENTATION_VALUES,
    VERIFY_METADATA_WARNING,
    FreeImageConfigError,
    FreeImageSearchSettings,
    Orientation,
    is_allowed_license,
    license_label,
    parse_free_image_settings,
)
from free_images.download import (
    DownloadedImage,
    ImageDownloadRejected,
    clean_filename,
    download_image,
    is_blocked_address,
    validate_image_url,
)
from free_images.openverse import (
    FreeImageResult,
    OpenverseError,
    build_search_params,
    normalize_result,
    normalize_results,
    search_images,
)
from free_images.tool import (
    FREE_IMAGE_SEARCH_TOOL_NAME,
    FreeImageBudget,
    FreeImageSearchRuntime,
    FreeImageToolOutcome,
    free_image_search_tool_definition,
    summarize_free_image_input,
)

__all__ = [
    "ALLOWED_IMAGE_MIME_TYPES",
    "ALLOWED_LICENSES",
    "DEFAULT_IMAGES",
    "DownloadedImage",
    "EGRESS_NOTICE",
    "EMPTY_FREE_IMAGE_SEARCH",
    "FREE_IMAGE_SEARCH_TOOL_NAME",
    "FreeImageBudget",
    "FreeImageConfigError",
    "FreeImageResult",
    "FreeImageSearchRuntime",
    "FreeImageSearchSettings",
    "FreeImageToolOutcome",
    "ImageDownloadRejected",
    "MAX_IMAGES",
    "MAX_IMAGE_BYTES",
    "MAX_IMAGE_PIXELS",
    "MAX_QUERY_CHARS",
    "MAX_SEARCHES_PER_GENERATION",
    "MAX_SEARCHES_PER_TURN",
    "MIN_IMAGES",
    "MIN_QUERY_CHARS",
    "OPENVERSE_IMAGE_SEARCH_URL",
    "OPENVERSE_TERMS_URL",
    "ORIENTATION_VALUES",
    "OpenverseError",
    "Orientation",
    "VERIFY_METADATA_WARNING",
    "build_search_params",
    "clean_filename",
    "download_image",
    "free_image_search_tool_definition",
    "is_allowed_license",
    "is_blocked_address",
    "license_label",
    "normalize_result",
    "normalize_results",
    "parse_free_image_settings",
    "search_images",
    "summarize_free_image_input",
    "validate_image_url",
]
