"""Keyless, licence-aware Iconify search for shot2code.

``search_icons`` is one canonical tool shared by native OpenAI, Anthropic and
Gemini sessions plus both Copilot runtimes. It searches only Iconify's fixed
public API origin, downloads SVGs itself, strips active content and external
references, then hands sanitized bytes to the existing local-asset boundary.

Automatic/model use is intentionally conservative: only icon sets whose
Iconify collection metadata names a licence in the fixed permissive SPDX
allowlist are eligible. Copyleft, share-alike, attribution-only,
non-commercial and unknown licences are skipped rather than silently imported.
"""

from icon_search.config import (
    ACCESS_NOTE,
    DEFAULT_ICONS,
    EGRESS_NOTICE,
    EMPTY_ICON_SEARCH,
    ICONIFY_API_ORIGIN,
    MAX_ICONS,
    MAX_SEARCHES_PER_GENERATION,
    MAX_SEARCHES_PER_TURN,
    PERMISSIVE_LICENSES,
    THIRD_PARTY_METADATA_WARNING,
    TRADEMARK_WARNING,
    IconSearchConfigError,
    IconSearchSettings,
    is_permissive_license,
    parse_icon_search_settings,
)
from icon_search.iconify import (
    IconCandidate,
    IconCollection,
    IconLicense,
    IconifyError,
    create_iconify_client,
    fetch_icon_svg,
    search_icon_candidates,
)
from icon_search.sanitize import SvgRejected, sanitize_svg
from icon_search.tool import (
    ICON_SEARCH_TOOL_NAME,
    IconSearchBudget,
    IconSearchRuntime,
    IconSearchToolOutcome,
    icon_search_tool_definition,
    summarize_icon_search_input,
)

__all__ = [
    "ACCESS_NOTE",
    "DEFAULT_ICONS",
    "EGRESS_NOTICE",
    "EMPTY_ICON_SEARCH",
    "ICONIFY_API_ORIGIN",
    "ICON_SEARCH_TOOL_NAME",
    "IconCandidate",
    "IconCollection",
    "IconLicense",
    "IconSearchBudget",
    "IconSearchConfigError",
    "IconSearchRuntime",
    "IconSearchSettings",
    "IconSearchToolOutcome",
    "IconifyError",
    "MAX_ICONS",
    "MAX_SEARCHES_PER_GENERATION",
    "MAX_SEARCHES_PER_TURN",
    "PERMISSIVE_LICENSES",
    "SvgRejected",
    "THIRD_PARTY_METADATA_WARNING",
    "TRADEMARK_WARNING",
    "create_iconify_client",
    "fetch_icon_svg",
    "icon_search_tool_definition",
    "is_permissive_license",
    "parse_icon_search_settings",
    "sanitize_svg",
    "search_icon_candidates",
    "summarize_icon_search_input",
]
