"""Failures a search can produce, phrased so a model can act on them.

Every provider fault funnels through :class:`WebSearchError`. The ``code`` is
stable and testable; the ``message`` is what the model and the user read, so it
says what happened *and* what to do about it, and never quotes a credential.
"""

from __future__ import annotations

from typing import Literal

WebSearchErrorCode = Literal[
    "not_configured",
    "invalid_request",
    "unauthorized",
    "payment_required",
    "forbidden",
    "rate_limited",
    "timeout",
    "network",
    "provider_error",
    "budget_exhausted",
]


class WebSearchError(Exception):
    """A search that could not be completed, with a code callers can branch on."""

    def __init__(self, code: WebSearchErrorCode, message: str):
        self.code: WebSearchErrorCode = code
        super().__init__(message)

    @property
    def message(self) -> str:
        return str(self)


# What each HTTP status from a search provider actually means for the person
# who configured it. Anything not listed is reported as a provider error.
_STATUS_CODES: dict[int, WebSearchErrorCode] = {
    400: "invalid_request",
    401: "unauthorized",
    402: "payment_required",
    403: "forbidden",
    422: "invalid_request",
    429: "rate_limited",
}


def error_for_status(
    status_code: int,
    provider_label: str,
    detail: str | None = None,
) -> WebSearchError:
    """Turn a provider HTTP status into an actionable failure.

    ``detail`` is the provider's own sentence when it sent one. It is appended
    rather than replacing shot2code's guidance, because a provider message
    usually says *what* went wrong and rarely says *where to fix it*.
    """
    code = _STATUS_CODES.get(status_code, "provider_error")
    guidance = {
        "invalid_request": (
            f"{provider_label} rejected the search request. Narrow the query "
            "and try again."
        ),
        "unauthorized": (
            f"{provider_label} rejected the API key (HTTP 401). Check the key "
            "in Settings → Web search, or switch that provider off."
        ),
        "payment_required": (
            f"{provider_label} reports no remaining credit (HTTP 402). Top up "
            "the account or switch web search off in Settings."
        ),
        "forbidden": (
            f"{provider_label} refused this request (HTTP 403). The key may "
            "lack access to the search endpoint, or the plan may not include "
            "it."
        ),
        "rate_limited": (
            f"{provider_label} is rate limiting this key (HTTP 429). Wait "
            "before searching again, or add an API key if you are on keyless "
            "access."
        ),
        "provider_error": (
            f"{provider_label} returned an unexpected response "
            f"(HTTP {status_code})."
        ),
    }[code]
    message = f"{guidance} {detail}".strip() if detail else guidance
    return WebSearchError(code, message)
