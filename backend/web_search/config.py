"""Validation for the web-search provider a user configures in Settings.

This mirrors :mod:`integrations.config` deliberately: the browser sends raw
JSON, so everything here turns it into a narrow, typed, bounded description or
refuses it with a sentence a person can act on.

Web search is **additive and off by default**. Nothing in this module changes
how a model provider, an image backend or the Copilot SDK behaves. When it is
switched off, no tool is advertised, no query leaves the machine and no
credential is read.

The API key is the only secret in this package. It lives on
:class:`WebSearchSettings` and never reaches
:class:`WebSearchSummary`, which is what the validation route, the diagnostics
and the logs are built from.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Literal, Mapping

WebSearchProvider = Literal["tavily", "exa"]
# How the provider is reached. ``keyless`` is Tavily's documented, rate-limited
# free trial mode; it is a separate explicit choice, never a silent fallback
# when a key is missing.
WebSearchAccessMode = Literal["api-key", "keyless"]

WEB_SEARCH_PROVIDERS: tuple[WebSearchProvider, ...] = ("tavily", "exa")
WEB_SEARCH_ACCESS_MODES: tuple[WebSearchAccessMode, ...] = ("api-key", "keyless")

# Only Tavily documents a keyless trial (`X-Tavily-Access-Mode: keyless`), so
# it is the only provider that may be configured without a credential.
KEYLESS_PROVIDERS: tuple[WebSearchProvider, ...] = ("tavily",)

PROVIDER_LABELS: dict[WebSearchProvider, str] = {
    "tavily": "Tavily",
    "exa": "Exa",
}

# Fixed endpoints. A user cannot point web search at an arbitrary host: the
# query text is the sensitive part of this feature, and it may only ever go to
# the provider that was chosen.
PROVIDER_ENDPOINTS: dict[WebSearchProvider, str] = {
    "tavily": "https://api.tavily.com/search",
    "exa": "https://api.exa.ai/search",
}

# Request shape. These bound what the model may ask for, and the frontend
# mirrors them so the UI can refuse a value before a generation does.
MIN_QUERY_CHARS = 3
MAX_QUERY_CHARS = 320
MIN_RESULTS = 1
MAX_RESULTS = 5
MAX_INCLUDE_DOMAINS = 10
MAX_DOMAIN_LENGTH = 253

# Response shape. A search result is untrusted text from the open web, so it is
# truncated hard before it is ever put in front of a model.
MAX_TITLE_CHARS = 160
MAX_SNIPPET_CHARS = 600
MAX_TOTAL_CHARS = 4_000

# Budgets. Both are counted by the tool runtime, not by the provider.
MAX_SEARCHES_PER_TURN = 3
MAX_SEARCHES_PER_GENERATION = 10

# Bounded page reading is a separate explicit capability. It does not inherit
# the web-search switch: search snippets and page bodies have different privacy
# and context-size consequences, so one opt-in must never imply the other.
MAX_PAGE_URL_CHARS = 2_048
MAX_PAGE_BYTES = 512 * 1024
MAX_PAGE_TEXT_CHARS = 16_000
MAX_PAGE_FETCHES_PER_TURN = 2
MAX_PAGE_FETCHES_PER_GENERATION = 5
MAX_PAGE_REDIRECTS = 3

# One request, one deadline. No retries: a slow search must not extend a
# generation, and a repeat is the model's decision to make.
REQUEST_TIMEOUT_SECONDS = 12.0
PAGE_FETCH_TIMEOUT_SECONDS = 12.0

MAX_API_KEY_LENGTH = 256

Recency = Literal["any", "day", "week", "month", "year"]
RECENCY_VALUES: tuple[Recency, ...] = ("any", "day", "week", "month", "year")

# A hostname, optionally with a leading dot, and nothing else: no scheme, no
# path, no port, no credentials, no wildcard.
_DOMAIN = re.compile(
    r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$"
)
_UNSAFE_TEXT = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class WebSearchConfigError(ValueError):
    """A web-search configuration the backend refuses to use."""


def _fail(message: str) -> WebSearchConfigError:
    return WebSearchConfigError(message)


def _as_mapping(value: object, label: str) -> Mapping[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise _fail(f"{label} must be an object.")
    return {str(key): item for key, item in value.items()}  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]


def _clean_text(value: object, label: str, limit: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise _fail(f"{label} must be text.")
    text = value.strip()
    if not text:
        return ""
    if len(text) > limit:
        raise _fail(f"{label} is too long (limit {limit} characters).")
    if _UNSAFE_TEXT.search(text) or "\n" in text or "\r" in text:
        raise _fail(f"{label} contains characters that are not allowed.")
    return text


def _clean_bool(value: object, label: str, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    raise _fail(f"{label} must be true or false.")


def normalize_domain(value: object) -> str | None:
    """A bare hostname, or ``None`` when the entry is not one.

    Accepts what people actually type - ``https://docs.python.org/3/``,
    ``DOCS.PYTHON.ORG``, ``.python.org`` - and reduces it to the registrable
    host. Anything with credentials, a port or a non-hostname shape is refused
    rather than guessed at, because a bad entry here would silently widen the
    set of sites a search may return.
    """
    if not isinstance(value, str):
        return None
    candidate = value.strip().lower()
    if not candidate:
        return None
    if "://" in candidate:
        candidate = candidate.split("://", 1)[1]
    # A user-info section would let "evil.com" hide behind "@good.com".
    if "@" in candidate:
        return None
    candidate = candidate.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    if ":" in candidate:
        return None
    candidate = candidate.lstrip(".").rstrip(".")
    if not candidate or len(candidate) > MAX_DOMAIN_LENGTH:
        return None
    if not _DOMAIN.match(candidate):
        return None
    return candidate


def host_matches_domain(host: str, domain: str) -> bool:
    """Whether ``host`` is ``domain`` or one of its subdomains."""
    host = host.strip().lower().rstrip(".")
    domain = domain.strip().lower().rstrip(".")
    if not host or not domain:
        return False
    return host == domain or host.endswith(f".{domain}")


@dataclass(frozen=True)
class WebSearchSummary:
    """The configuration with the credential removed.

    Separate type from :class:`WebSearchSettings` on purpose, so an API
    response, a log line or a history entry cannot carry a key by accident.
    """

    enabled: bool
    provider: WebSearchProvider
    provider_label: str
    access_mode: WebSearchAccessMode
    has_api_key: bool
    endpoint: str
    usable: bool
    reason: str | None
    max_results: int = MAX_RESULTS
    max_searches_per_turn: int = MAX_SEARCHES_PER_TURN
    max_searches_per_generation: int = MAX_SEARCHES_PER_GENERATION
    page_fetch_enabled: bool = False
    max_page_bytes: int = MAX_PAGE_BYTES
    max_page_text_chars: int = MAX_PAGE_TEXT_CHARS
    max_page_fetches_per_turn: int = MAX_PAGE_FETCHES_PER_TURN
    max_page_fetches_per_generation: int = MAX_PAGE_FETCHES_PER_GENERATION

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "provider": self.provider,
            "providerLabel": self.provider_label,
            "accessMode": self.access_mode,
            "hasApiKey": self.has_api_key,
            "endpoint": self.endpoint,
            "usable": self.usable,
            "reason": self.reason,
            "maxResults": self.max_results,
            "maxSearchesPerTurn": self.max_searches_per_turn,
            "maxSearchesPerGeneration": self.max_searches_per_generation,
            "pageFetchEnabled": self.page_fetch_enabled,
            "maxPageBytes": self.max_page_bytes,
            "maxPageTextChars": self.max_page_text_chars,
            "maxPageFetchesPerTurn": self.max_page_fetches_per_turn,
            "maxPageFetchesPerGeneration": self.max_page_fetches_per_generation,
        }


@dataclass(frozen=True)
class WebSearchSettings:
    """What the user configured, already validated.

    ``api_key`` is the only secret this package holds. It is backend-only: it
    arrives on the request, is used to call the provider, and is never written
    to history, a snapshot, a tool argument or a response.
    """

    enabled: bool = False
    provider: WebSearchProvider = "tavily"
    access_mode: WebSearchAccessMode = "api-key"
    api_key: str | None = None
    page_fetch_enabled: bool = False

    @property
    def provider_label(self) -> str:
        return PROVIDER_LABELS[self.provider]

    @property
    def endpoint(self) -> str:
        return PROVIDER_ENDPOINTS[self.provider]

    @property
    def unusable_reason(self) -> str | None:
        """Why this configuration cannot run a search, or ``None``."""
        if not self.enabled:
            return "Web search is switched off."
        if self.access_mode == "keyless":
            if self.provider not in KEYLESS_PROVIDERS:
                return (
                    f"{self.provider_label} has no keyless mode. Add an API "
                    "key or choose Tavily."
                )
            return None
        if not self.api_key:
            return (
                f"{self.provider_label} needs an API key. Add one in Settings "
                "→ Web search, or use Tavily's keyless trial."
            )
        return None

    @property
    def is_usable(self) -> bool:
        return self.unusable_reason is None

    @property
    def has_any_tool(self) -> bool:
        return self.is_usable or self.page_fetch_enabled

    def summary(self) -> WebSearchSummary:
        return WebSearchSummary(
            enabled=self.enabled,
            provider=self.provider,
            provider_label=self.provider_label,
            access_mode=self.access_mode,
            has_api_key=bool(self.api_key),
            endpoint=self.endpoint,
            usable=self.is_usable,
            reason=self.unusable_reason,
            page_fetch_enabled=self.page_fetch_enabled,
        )

    def safe_metadata(self) -> dict[str, Any]:
        return self.summary().to_dict()


EMPTY_WEB_SEARCH = WebSearchSettings()


def _parse_provider(raw: object) -> WebSearchProvider:
    value = _clean_text(raw, "webSearch.provider", 32).lower()
    if not value:
        return "tavily"
    if value not in WEB_SEARCH_PROVIDERS:
        raise _fail(
            f"webSearch.provider must be one of "
            f"{', '.join(WEB_SEARCH_PROVIDERS)}."
        )
    return value  # pyright: ignore[reportReturnType]


def _parse_access_mode(raw: object) -> WebSearchAccessMode:
    value = _clean_text(raw, "webSearch.accessMode", 32).lower()
    if not value:
        return "api-key"
    if value not in WEB_SEARCH_ACCESS_MODES:
        raise _fail(
            "webSearch.accessMode must be 'api-key' or 'keyless'."
        )
    return value  # pyright: ignore[reportReturnType]


def _parse_api_key(raw: object) -> str | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise _fail("webSearch.apiKey must be text.")
    key = raw.strip()
    if not key:
        return None
    if len(key) > MAX_API_KEY_LENGTH:
        raise _fail(
            f"webSearch.apiKey is too long (limit {MAX_API_KEY_LENGTH} "
            "characters)."
        )
    # The message must never quote the value, so this only reports the shape.
    if _UNSAFE_TEXT.search(key) or any(char.isspace() for char in key):
        raise _fail("webSearch.apiKey contains characters that are not allowed.")
    return key


def parse_web_search_settings(params: object) -> WebSearchSettings:
    """Read the ``webSearch`` block from a request payload.

    A structurally broken block is refused. A block that is merely switched off
    or incomplete comes back unusable, because a half-configured optional extra
    must never fail a generation the model providers could have run.
    """
    payload = _as_mapping(params, "request")
    raw = payload.get("webSearch")
    if raw is None:
        return EMPTY_WEB_SEARCH
    block = _as_mapping(raw, "webSearch")
    if not block:
        return EMPTY_WEB_SEARCH

    enabled = _clean_bool(block.get("enabled"), "webSearch.enabled")
    page_fetch_enabled = _clean_bool(
        block.get("pageFetchEnabled"),
        "webSearch.pageFetchEnabled",
    )
    provider = _parse_provider(block.get("provider"))
    access_mode = _parse_access_mode(block.get("accessMode"))
    api_key = _parse_api_key(block.get("apiKey"))

    return WebSearchSettings(
        enabled=enabled,
        provider=provider,
        access_mode=access_mode,
        # A keyless connection deliberately drops any saved key so the request
        # cannot accidentally be keyed after the user asked for the trial.
        api_key=None if access_mode == "keyless" else api_key,
        page_fetch_enabled=page_fetch_enabled,
    )


def web_search_settings_from_env() -> WebSearchSettings:
    """A configuration built from ``backend/.env``, for headless callers.

    Used by evals and scripts that have no Settings dialog. Like every other
    credential in shot2code, the environment is a fallback, never an override:
    a request that carries its own ``webSearch`` block wins.
    """
    tavily = (os.environ.get("TAVILY_API_KEY") or "").strip()
    exa = (os.environ.get("EXA_API_KEY") or "").strip()
    if tavily:
        return WebSearchSettings(enabled=True, provider="tavily", api_key=tavily)
    if exa:
        return WebSearchSettings(enabled=True, provider="exa", api_key=exa)
    return EMPTY_WEB_SEARCH


def merge_web_search_api_key(
    settings: WebSearchSettings,
    env_key: str | None,
) -> WebSearchSettings:
    """Fill a missing key from the environment without changing anything else.

    The provider, the access mode and the on/off switch always come from the
    request. Only an absent credential is supplied, and only for the provider
    the user actually chose.
    """
    if settings.access_mode == "keyless" or settings.api_key:
        return settings
    key = (env_key or "").strip()
    if not key:
        return settings
    return WebSearchSettings(
        enabled=settings.enabled,
        provider=settings.provider,
        access_mode=settings.access_mode,
        api_key=key,
        page_fetch_enabled=settings.page_fetch_enabled,
    )
