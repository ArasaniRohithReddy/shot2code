"""Provider-neutral web search for shot2code.

Canonical ``search_web`` and optional ``read_web_page`` tools are offered to
every runtime through the same shot2code-owned implementation.

The pieces:

* :mod:`web_search.config` validates what the user configured. It holds the
  only secret-bearing object in this package and never lets a credential into
  a summary, a log line or an API response.
* :mod:`web_search.providers` talks to a fixed provider endpoint over HTTPS
  with an explicit timeout, no redirects and no raw page content.
* :mod:`web_search.tool` is the tool definition, the per-turn and
  per-generation budgets, and the bounded, explicitly-untrusted response.
"""

from web_search.config import (
    EMPTY_WEB_SEARCH,
    MAX_INCLUDE_DOMAINS,
    MAX_PAGE_BYTES,
    MAX_PAGE_FETCHES_PER_GENERATION,
    MAX_PAGE_FETCHES_PER_TURN,
    MAX_PAGE_TEXT_CHARS,
    MAX_RESULTS,
    MAX_SEARCHES_PER_GENERATION,
    MAX_SEARCHES_PER_TURN,
    MAX_SNIPPET_CHARS,
    MAX_TITLE_CHARS,
    MAX_TOTAL_CHARS,
    RECENCY_VALUES,
    WEB_SEARCH_PROVIDERS,
    WebSearchAccessMode,
    WebSearchConfigError,
    WebSearchProvider,
    WebSearchSettings,
    WebSearchSummary,
    parse_web_search_settings,
    web_search_settings_from_env,
)
from web_search.errors import WebSearchError, WebSearchErrorCode
from web_search.providers import WebSearchResult, run_provider_search
from web_search.tool import (
    READ_WEB_PAGE_TOOL_NAME,
    WEB_SEARCH_TOOL_NAME,
    PageFetchBudget,
    WebSearchBudget,
    WebSearchRuntime,
    WebSearchToolOutcome,
    page_fetch_tool_definition,
    web_search_tool_definition,
)

__all__ = [
    "EMPTY_WEB_SEARCH",
    "MAX_INCLUDE_DOMAINS",
    "MAX_PAGE_BYTES",
    "MAX_PAGE_FETCHES_PER_GENERATION",
    "MAX_PAGE_FETCHES_PER_TURN",
    "MAX_PAGE_TEXT_CHARS",
    "MAX_RESULTS",
    "MAX_SEARCHES_PER_GENERATION",
    "MAX_SEARCHES_PER_TURN",
    "MAX_SNIPPET_CHARS",
    "MAX_TITLE_CHARS",
    "MAX_TOTAL_CHARS",
    "RECENCY_VALUES",
    "READ_WEB_PAGE_TOOL_NAME",
    "WEB_SEARCH_PROVIDERS",
    "WEB_SEARCH_TOOL_NAME",
    "PageFetchBudget",
    "WebSearchAccessMode",
    "WebSearchBudget",
    "WebSearchConfigError",
    "WebSearchError",
    "WebSearchErrorCode",
    "WebSearchProvider",
    "WebSearchResult",
    "WebSearchRuntime",
    "WebSearchSettings",
    "WebSearchSummary",
    "WebSearchToolOutcome",
    "parse_web_search_settings",
    "page_fetch_tool_definition",
    "run_provider_search",
    "web_search_settings_from_env",
    "web_search_tool_definition",
]
