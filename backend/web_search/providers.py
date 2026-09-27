"""The two search backends shot2code will talk to.

Both adapters are deliberately small and identical in shape: one POST to a
**fixed** endpoint, an explicit timeout, redirects disabled, and a response
reduced to title / URL / snippet. Nothing here fetches a page, follows a link
or returns raw HTML - the model sees ranked snippets and never a document.

Tavily is primary: its free plan is a recurring 1,000 credits a month with no
card, and it additionally documents a keyless, rate-limited trial mode
(``X-Tavily-Access-Mode: keyless``). Exa is offered as an alternative for
people who already have an account; it has no keyless mode.

Domain restrictions are enforced **twice**: passed to the provider when it
supports them, and re-applied locally to whatever comes back. A provider that
ignores or loosens the filter must not be able to widen what the model reads.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence, cast
from urllib.parse import urlsplit

import httpx

from web_search.config import (
    MAX_RESULTS,
    PROVIDER_ENDPOINTS,
    PROVIDER_LABELS,
    REQUEST_TIMEOUT_SECONDS,
    Recency,
    WebSearchSettings,
    host_matches_domain,
)
from web_search.errors import WebSearchError, error_for_status

# Tavily takes the recency window by name; Exa takes a date, so its adapter
# converts instead. "any" means no filter at all for both.
_TAVILY_TIME_RANGE: dict[str, str] = {
    "day": "day",
    "week": "week",
    "month": "month",
    "year": "year",
}

_EXA_RECENCY_DAYS: dict[str, int] = {
    "day": 1,
    "week": 7,
    "month": 31,
    "year": 365,
}


@dataclass(frozen=True)
class WebSearchResult:
    """One ranked hit, already reduced to what a model can use."""

    title: str
    url: str
    snippet: str
    published: str | None = None

    @property
    def host(self) -> str:
        try:
            return (urlsplit(self.url).hostname or "").lower()
        except ValueError:
            return ""


def _is_public_http_url(url: object) -> bool:
    """Only absolute http(s) URLs with a host are worth showing a model."""
    if not isinstance(url, str) or not url.strip():
        return False
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return False
    return parts.scheme in {"http", "https"} and bool(parts.hostname)


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _provider_detail(response: httpx.Response) -> str | None:
    """The provider's own explanation, when it sent a usable one."""
    try:
        payload: object = response.json()
    except ValueError:
        return None
    if isinstance(payload, str):
        return payload.strip()[:200] or None
    if not isinstance(payload, dict):
        return None
    data: dict[str, Any] = payload  # pyright: ignore[reportUnknownVariableType]
    for key in ("detail", "error", "message"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:200]
        if isinstance(value, dict):
            nested: object = cast(dict[str, Any], value).get("message")
            if isinstance(nested, str) and nested.strip():
                return nested.strip()[:200]
    return None


def _filter_to_domains(
    results: Sequence[WebSearchResult],
    include_domains: Sequence[str],
) -> list[WebSearchResult]:
    """Re-apply the domain restriction locally.

    The provider is asked to filter, but the answer is not trusted: a provider
    that ignores ``include_domains``, or matches it loosely, would otherwise
    decide what the model is allowed to read.
    """
    if not include_domains:
        return list(results)
    return [
        result
        for result in results
        if any(host_matches_domain(result.host, domain) for domain in include_domains)
    ]


async def _post(
    settings: WebSearchSettings,
    payload: dict[str, Any],
    headers: dict[str, str],
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """One POST to the provider's fixed endpoint, or an actionable failure."""
    label = PROVIDER_LABELS[settings.provider]
    endpoint = PROVIDER_ENDPOINTS[settings.provider]
    owns_client = client is None
    # follow_redirects stays off: a redirect could move the request - and its
    # Authorization header - to a host the user never configured.
    http = client or httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT_SECONDS, follow_redirects=False
    )
    try:
        response = await http.post(endpoint, json=payload, headers=headers)
    except httpx.TimeoutException as exc:
        raise WebSearchError(
            "timeout",
            f"{label} did not respond within "
            f"{int(REQUEST_TIMEOUT_SECONDS)} seconds. Try again or continue "
            "without web search.",
        ) from exc
    except httpx.HTTPError as exc:
        raise WebSearchError(
            "network",
            f"Could not reach {label}. Check this machine's network access "
            "or switch web search off in Settings.",
        ) from exc
    finally:
        if owns_client:
            await http.aclose()

    if response.is_redirect:
        raise WebSearchError(
            "provider_error",
            f"{label} redirected the search request, which shot2code does not "
            "follow.",
        )
    if response.status_code >= 400:
        raise error_for_status(
            response.status_code, label, _provider_detail(response)
        )

    try:
        body: object = response.json()
    except ValueError as exc:
        raise WebSearchError(
            "provider_error", f"{label} returned a response that is not JSON."
        ) from exc
    if not isinstance(body, dict):
        raise WebSearchError(
            "provider_error", f"{label} returned an unexpected response shape."
        )
    return body  # pyright: ignore[reportUnknownVariableType]


def _entries(body: dict[str, Any]) -> list[dict[str, Any]]:
    raw = body.get("results")
    if not isinstance(raw, list):
        return []
    return [entry for entry in raw if isinstance(entry, dict)]  # pyright: ignore[reportUnknownVariableType]


async def _search_tavily(
    settings: WebSearchSettings,
    query: str,
    max_results: int,
    recency: Recency,
    include_domains: Sequence[str],
    client: httpx.AsyncClient | None,
) -> list[WebSearchResult]:
    payload: dict[str, Any] = {
        "query": query,
        # `basic` is one credit per search; `advanced` is two. A code-generation
        # run does not need the deeper mode, and the free plan is finite.
        "search_depth": "basic",
        "max_results": max_results,
        "topic": "general",
        # Never ask for page bodies or a generated answer: shot2code shows the
        # model ranked snippets, not documents, and an answer would cost more.
        "include_answer": False,
        "include_raw_content": False,
        "include_images": False,
    }
    time_range = _TAVILY_TIME_RANGE.get(recency)
    if time_range:
        payload["time_range"] = time_range
    if include_domains:
        payload["include_domains"] = list(include_domains)

    headers = {"Content-Type": "application/json"}
    if settings.access_mode == "keyless":
        headers["X-Tavily-Access-Mode"] = "keyless"
    elif settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"

    body = await _post(settings, payload, headers, client)
    results: list[WebSearchResult] = []
    for entry in _entries(body):
        url = _text(entry.get("url"))
        if not _is_public_http_url(url):
            continue
        results.append(
            WebSearchResult(
                title=_text(entry.get("title")) or url,
                url=url,
                snippet=_text(entry.get("content")),
                published=_text(entry.get("published_date")) or None,
            )
        )
    return results


async def _search_exa(
    settings: WebSearchSettings,
    query: str,
    max_results: int,
    recency: Recency,
    include_domains: Sequence[str],
    client: httpx.AsyncClient | None,
) -> list[WebSearchResult]:
    payload: dict[str, Any] = {
        "query": query,
        "numResults": max_results,
        "type": "auto",
        # Highlights are short relevant excerpts. `text` would return the page
        # body, which this feature deliberately never asks for.
        "contents": {"highlights": {"numSentences": 3, "highlightsPerUrl": 1}},
    }
    days = _EXA_RECENCY_DAYS.get(recency)
    if days:
        from datetime import datetime, timedelta, timezone

        start = datetime.now(timezone.utc) - timedelta(days=days)
        payload["startPublishedDate"] = start.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    if include_domains:
        payload["includeDomains"] = list(include_domains)

    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        headers["x-api-key"] = settings.api_key

    body = await _post(settings, payload, headers, client)
    results: list[WebSearchResult] = []
    for entry in _entries(body):
        url = _text(entry.get("url"))
        if not _is_public_http_url(url):
            continue
        raw_highlights = entry.get("highlights")
        highlights = (
            " ".join(_text(item) for item in raw_highlights)  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
            if isinstance(raw_highlights, list)
            else ""
        )
        results.append(
            WebSearchResult(
                title=_text(entry.get("title")) or url,
                url=url,
                snippet=highlights.strip() or _text(entry.get("summary")),
                published=_text(entry.get("publishedDate")) or None,
            )
        )
    return results


async def run_provider_search(
    settings: WebSearchSettings,
    query: str,
    max_results: int,
    recency: Recency,
    include_domains: Sequence[str],
    client: httpx.AsyncClient | None = None,
) -> list[WebSearchResult]:
    """Run one search against the configured provider.

    Returns at most ``max_results`` hits, already restricted to
    ``include_domains`` locally as well as at the provider.
    """
    reason = settings.unusable_reason
    if reason is not None:
        raise WebSearchError("not_configured", reason)

    capped = max(1, min(int(max_results), MAX_RESULTS))
    domains = list(include_domains)
    if settings.provider == "exa":
        results = await _search_exa(
            settings, query, capped, recency, domains, client
        )
    else:
        results = await _search_tavily(
            settings, query, capped, recency, domains, client
        )
    return _filter_to_domains(results, domains)[:capped]
