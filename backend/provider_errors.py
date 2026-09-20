"""One place that turns a provider failure into something a user can act on.

Every provider fails differently - an OpenAI ``APIError`` with billing text, an
Anthropic 401, a Gemini ``PermissionDenied``, an httpx connection reset from a
BYOK endpoint - but a user only ever needs to know *which kind* of problem it
is and what to do next. Classifying in one module keeps that answer identical
in the generation stream, in the validation endpoint and in the logs.

Two rules hold everywhere in here:

* **Nothing leaks.** Provider errors routinely echo the request back, headers
  and all, so every message passes through :func:`redact_secrets` before it is
  returned or printed.
* **Messages are for people.** They name the provider, say what went wrong and
  what to change; they never dump a stack trace or a raw payload.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Literal

# What kind of problem this is. ``ready`` is only ever produced by a successful
# validation; every classification of a real error uses one of the others.
ErrorCategory = Literal[
    "ready",
    "credentials",
    "billing",
    "quota",
    "permissions",
    "model",
    "network",
    "configuration",
    "unknown",
]

ProviderName = Literal[
    "openai", "anthropic", "gemini", "replicate", "copilot", "copilot-byok"
]

PROVIDER_LABELS: dict[str, str] = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "gemini": "Google Gemini",
    "replicate": "Replicate",
    "copilot": "GitHub Copilot",
    "copilot-byok": "Copilot SDK BYOK",
}

# Anything shaped like a credential. Provider errors quote the failing request
# back at you, so these patterns are what stands between an API key and a log
# file the user might paste into an issue.
_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Vendor-prefixed keys: OpenAI (sk-...), Anthropic (sk-ant-...), Replicate
    # (r8_...), GitHub (ghp_/gho_/ghu_/ghs_/ghr_/github_pat_), Google (AIza...).
    re.compile(r"\bsk-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"\br8_[A-Za-z0-9]{8,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{8,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{8,}"),
    re.compile(r"\bAIza[A-Za-z0-9_\-]{8,}"),
    # Authorization headers and bearer tokens in any casing. The optional
    # quotes cover dict reprs like {'x-api-key': 'value'} that providers
    # routinely echo back in an error.
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{8,}"),
    re.compile(
        r"(?i)\b(authorization|x-api-key|api-key)\b[\"']?\s*[:=]\s*[\"']?[^\s,'\"}\]]+"
    ),
    # Credentials passed as query or JSON parameters.
    re.compile(
        r"(?i)\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)"
        r"\b[\"']?\s*[:=]\s*[\"']?[^\s,'\"}\]]{4,}"
    ),
    # "Incorrect API key provided: <value>" and friends: providers put a few
    # words between the noun and the value, and the value has no vendor prefix
    # when the user typed it themselves.
    re.compile(
        r"(?i)\bapi[ _-]?key\b[^:=\n]{0,24}[:=]\s*[\"']?[^\s,'\"}\]]{4,}"
    ),
    # Credentials embedded in a URL.
    re.compile(r"(?i)\b([a-z][a-z0-9+.\-]*)://[^\s/@]+:[^\s/@]+@"),
)

REDACTED = "[redacted]"

# Cap what we echo: provider errors can carry an entire request body.
MAX_MESSAGE_LENGTH = 400


def redact_secrets(text: str) -> str:
    """The same text with anything credential-shaped masked."""
    if not text:
        return ""
    redacted = text
    for pattern in _SECRET_PATTERNS:
        if pattern.pattern.endswith("@"):
            redacted = pattern.sub(r"\1://" + REDACTED + "@", redacted)
        else:
            redacted = pattern.sub(REDACTED, redacted)
    return redacted


def redact_values(text: str, values: Iterable[str | None]) -> str:
    """Mask credentials we *know* the exact value of.

    Pattern matching cannot recognise a user's own key when the provider quotes
    it without a recognisable prefix, so a caller that holds the credential
    passes it here and the value is removed literally.
    """
    if not text:
        return ""
    redacted = text
    for value in values:
        if isinstance(value, str) and len(value.strip()) >= 4:
            redacted = redacted.replace(value.strip(), REDACTED)
    return redacted


def _condense(text: str, limit: int = MAX_MESSAGE_LENGTH) -> str:
    collapsed = " ".join(redact_secrets(text).split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[:limit].rstrip() + "…"


@dataclass(frozen=True)
class ProviderErrorInfo:
    """What went wrong, in a shape both the UI and the logs can use."""

    category: ErrorCategory
    message: str
    provider: str | None = None
    # The provider's own wording, redacted and bounded. Useful context to show
    # under the actionable message; never a stack trace.
    detail: str = ""

    @property
    def is_ready(self) -> bool:
        return self.category == "ready"


def _status_code(error: BaseException) -> int | None:
    for attribute in ("status_code", "status", "code", "http_status"):
        value = getattr(error, attribute, None)
        if isinstance(value, int) and 100 <= value <= 599:
            return value
    response = getattr(error, "response", None)
    if response is not None:
        value = getattr(response, "status_code", None)
        if isinstance(value, int):
            return value
    return None


def _error_text(error: BaseException) -> str:
    """Everything the provider said, flattened for matching."""
    parts: list[str] = [type(error).__name__, str(error)]
    for attribute in ("message", "reason", "detail"):
        value = getattr(error, attribute, None)
        if isinstance(value, str):
            parts.append(value)
    body = getattr(error, "body", None)
    if isinstance(body, dict):
        parts.append(str(body))
    elif isinstance(body, str):
        parts.append(body)
    return " ".join(part for part in parts if part)


def _contains(haystack: str, needles: tuple[str, ...]) -> bool:
    return any(needle in haystack for needle in needles)


_BILLING_HINTS = (
    "no credits remaining",
    "credit balance is too low",
    "insufficient credits",
    "insufficient_quota",
    "insufficient funds",
    "billing",
    "payment required",
    "purchase more credits",
    "upgrade your plan",
    "spending limit",
    "exceeded your current quota",
)

_QUOTA_HINTS = (
    "rate limit",
    "rate_limit",
    "too many requests",
    "quota exceeded",
    "resource_exhausted",
    "resource exhausted",
    "overloaded",
    "capacity",
    "try again later",
)

_CREDENTIAL_HINTS = (
    "invalid api key",
    "incorrect api key",
    "invalid_api_key",
    "invalid x-api-key",
    "api key not valid",
    "authentication",
    "unauthorized",
    "unauthenticated",
    "invalid token",
    "invalid credentials",
    "no api key",
    "missing api key",
    "could not authenticate",
)

_PERMISSION_HINTS = (
    "permission",
    "forbidden",
    "not allowed",
    "does not have access",
    "no access to",
    "must be verified",
    "verify organization",
    "unsupported_country",
)

_MODEL_HINTS = (
    "model not found",
    "model_not_found",
    "does not exist",
    "unknown model",
    "invalid model",
    "unsupported model",
    "no such model",
    "deprecated model",
)

# shot2code drives a model with screenshots and tool calls. An endpoint model
# that cannot do both is unusable for generation however healthy it is, and the
# wording providers use for that is distinctive enough to name.
_CAPABILITY_HINTS = (
    "does not support tools",
    "does not support tool",
    "tools are not supported",
    "tool_choice",
    "function calling is not",
    "function_call is not supported",
    "does not support function",
    "does not support image",
    "image input is not supported",
    "image_url is not supported",
    "vision is not supported",
    "multimodal",
    "unsupported content type",
    "only text",
)

_NETWORK_HINTS = (
    "connection error",
    "connection refused",
    "connection reset",
    "connect timeout",
    "read timeout",
    "timed out",
    "timeout",
    "name or service not known",
    "nodename nor servname",
    "temporary failure in name resolution",
    "getaddrinfo",
    "ssl",
    "certificate",
    "network is unreachable",
    "connection aborted",
)

_CONFIGURATION_HINTS = (
    "base_url",
    "baseurl",
    "endpoint",
    "deployment",
    "not configured",
    "missing",
    "no usable credential",
)

_NETWORK_TYPES = (
    "APIConnectionError",
    "APITimeoutError",
    "ConnectError",
    "ConnectTimeout",
    "ReadTimeout",
    "WriteTimeout",
    "PoolTimeout",
    "ConnectionError",
    "TimeoutError",
    "ServerDisconnectedError",
    "ClientConnectorError",
    "ClientOSError",
    "SSLError",
    "SSLCertVerificationError",
    "gaierror",
)

_ACTIONS: dict[ErrorCategory, str] = {
    "credentials": "Check the API key in Settings and try again.",
    "billing": "Add credits or update the billing details on the provider's "
    "dashboard, then try again.",
    "quota": "Wait for the limit to reset, or lower the number of variants, "
    "then try again.",
    "permissions": "The account does not have access to this model. Enable it "
    "on the provider's dashboard or pick another model.",
    "model": "Pick a different model in Settings.",
    "network": "Check the network connection (and any proxy or firewall), "
    "then try again.",
    "configuration": "Check the provider settings and try again.",
    "unknown": "Try again, or pick a different model.",
}

# What shot2code needs from any model it generates with, said once.
CAPABILITY_REQUIREMENT = (
    "shot2code needs a model with image input (vision) and tool calling."
)
CAPABILITY_ACTION = f"{CAPABILITY_REQUIREMENT} Pick a model that supports both."


def category_action(category: ErrorCategory) -> str:
    """The sentence telling a user what to do about ``category``."""
    return _ACTIONS.get(category, _ACTIONS["unknown"])


def provider_label(provider: str | None) -> str:
    if not provider:
        return "The provider"
    return PROVIDER_LABELS.get(provider, provider)


def is_capability_gap(text: str) -> bool:
    """Whether a provider message is about missing vision or tool calling."""
    return _contains(text.lower(), _CAPABILITY_HINTS)


def classify_error_text(text: str, status_code: int | None = None) -> ErrorCategory:
    """The category for an already-flattened provider message.

    Order matters. Billing wording usually also mentions quota (OpenAI's
    "exceeded your current quota, please check your plan and billing details"
    is a billing problem, not a rate limit), so billing is matched first.
    """
    lowered = text.lower()

    if _contains(lowered, _BILLING_HINTS):
        return "billing"
    if status_code == 402:
        return "billing"
    if _contains(lowered, _CREDENTIAL_HINTS) or status_code == 401:
        return "credentials"
    if _contains(lowered, _QUOTA_HINTS) or status_code == 429:
        return "quota"
    # A model that cannot take an image or call a tool is the wrong model for
    # this app, which is a model problem rather than a mystery.
    if _contains(lowered, _CAPABILITY_HINTS):
        return "model"
    if _contains(lowered, _MODEL_HINTS):
        return "model"
    if _contains(lowered, _PERMISSION_HINTS) or status_code == 403:
        return "permissions"
    if status_code == 404:
        return "model"
    if _contains(lowered, _NETWORK_HINTS):
        return "network"
    if _contains(lowered, _CONFIGURATION_HINTS):
        return "configuration"
    return "unknown"


def classify_provider_error(
    error: BaseException,
    provider: str | None = None,
) -> ProviderErrorInfo:
    """Turn any provider exception into a category plus a safe message."""
    type_name = type(error).__name__
    text = _error_text(error)
    status = _status_code(error)

    if type_name in _NETWORK_TYPES:
        category: ErrorCategory = "network"
    else:
        category = classify_error_text(text, status)
        # A transport-level failure can still carry wording that looks like a
        # configuration problem; trust the exception type first.
        if category == "unknown" and type_name.endswith("TimeoutError"):
            category = "network"

    label = provider_label(provider)
    detail = _condense(str(error) or type_name)
    headline = {
        "credentials": f"{label} rejected the credentials.",
        "billing": f"{label} reports no available credit for this account.",
        "quota": f"{label} is rate limiting or out of quota right now.",
        "permissions": f"{label} denied access to this model.",
        "model": f"{label} does not offer the requested model.",
        "network": f"Could not reach {label}.",
        "configuration": f"{label} is not configured correctly.",
        "unknown": f"{label} returned an error.",
    }.get(category, f"{label} returned an error.")

    action = category_action(category)
    if category == "model" and is_capability_gap(text):
        headline = f"{label} accepted the request but the model cannot run it."
        action = CAPABILITY_ACTION

    message = f"{headline} {action}"
    if detail:
        message = f"{message} ({detail})"
    return ProviderErrorInfo(
        category=category,
        message=_condense(message, MAX_MESSAGE_LENGTH + 160),
        provider=provider,
        detail=detail,
    )
