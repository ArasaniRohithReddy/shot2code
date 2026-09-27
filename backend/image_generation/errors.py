"""One failure shape for every image provider.

Image generation fans out: N prompts, N independent calls, and any subset of
them can fail for a different reason. The old code collapsed all of that into
``None`` and reported success anyway, so a user saw blank tiles and a green
"Generated 3 images" for a run that generated nothing.

Everything in here exists to stop that. A provider call either returns an
image or raises :class:`ImageProviderFailure`, which carries the same
``ErrorCategory`` vocabulary :mod:`provider_errors` already uses so the UI has
exactly one set of categories to render, plus a sentence saying what to do.
Messages are redacted by :mod:`provider_errors` before they leave here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from provider_errors import (
    ErrorCategory,
    ProviderErrorInfo,
    category_action,
    classify_provider_error,
    provider_label,
    redact_secrets,
    redact_values,
)

# Provider ids used by the image subsystem. They are deliberately distinct from
# the text-model provider ids: an image provider is chosen and credentialed
# separately, and conflating them would let an image failure blame the model.
ImageProviderId = str

IMAGE_PROVIDER_LABELS: dict[str, str] = {
    "replicate": "Replicate",
    "cloudflare": "Cloudflare Workers AI",
    "openai-compatible": "the OpenAI-compatible image endpoint",
}

# HTTP status codes that mean something specific for image APIs. These are
# checked before any text matching, because a status code cannot be reworded by
# a provider whereas an error string can.
_STATUS_CATEGORIES: dict[int, ErrorCategory] = {
    400: "configuration",
    401: "credentials",
    402: "billing",
    403: "permissions",
    404: "model",
    408: "network",
    413: "configuration",
    422: "configuration",
    429: "quota",
    504: "network",
}

_IMAGE_ACTIONS: dict[ErrorCategory, str] = {
    "quota": (
        "The provider is rate limiting or the account allocation is used up. "
        "Wait for it to reset, generate fewer images at once, or switch image "
        "provider in Settings."
    ),
    "billing": (
        "The account has no credit left for image generation. Top it up on the "
        "provider's dashboard, or switch image provider in Settings."
    ),
    "credentials": (
        "Check the image provider credentials in Settings (or backend/.env) "
        "and try again."
    ),
    "model": (
        "The image model was rejected. Pick a different image model in "
        "Settings."
    ),
}


def image_provider_label(provider: str | None) -> str:
    if not provider:
        return "The image provider"
    return IMAGE_PROVIDER_LABELS.get(provider) or provider_label(provider)


def image_category_action(category: ErrorCategory) -> str:
    """What to do about ``category``, worded for image generation."""
    return _IMAGE_ACTIONS.get(category, category_action(category))


@dataclass(frozen=True)
class ImageProviderFailure(Exception):
    """A single image call that did not produce an image.

    ``category`` and ``action`` are what the UI renders; ``detail`` is the
    provider's own redacted wording, kept for the run log and the tool result
    so a model can decide whether retrying is worth it.
    """

    category: ErrorCategory
    message: str
    provider: str | None = None
    action: str = ""
    detail: str = ""
    status_code: int | None = None

    def __str__(self) -> str:
        return self.message

    @property
    def is_retryable(self) -> bool:
        """Whether trying the same call again could plausibly work."""
        return self.category in {"quota", "network", "unknown"}

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "category": self.category,
            "message": self.message,
            "action": self.action or image_category_action(self.category),
            "retryable": self.is_retryable,
        }
        if self.provider:
            payload["provider"] = self.provider
        if self.detail:
            payload["detail"] = self.detail
        return payload


def _headline(category: ErrorCategory, provider: str | None) -> str:
    label = image_provider_label(provider)
    return {
        "credentials": f"{label} rejected the credentials.",
        "billing": f"{label} reports no available credit for this account.",
        "quota": f"{label} is rate limiting or out of allocation right now.",
        "permissions": f"{label} denied access to this image model.",
        "model": f"{label} does not offer the requested image model.",
        "network": f"Could not reach {label}.",
        "configuration": f"{label} rejected the request as malformed.",
    }.get(category, f"{label} returned an error.")


def image_failure(
    category: ErrorCategory,
    provider: str | None,
    *,
    detail: str = "",
    status_code: int | None = None,
    headline: str | None = None,
) -> ImageProviderFailure:
    """Build a failure from a category we already know."""
    action = image_category_action(category)
    line = headline or _headline(category, provider)
    safe_detail = redact_secrets(detail)[:400].strip()
    message = f"{line} {action}"
    if safe_detail:
        message = f"{message} ({safe_detail})"
    return ImageProviderFailure(
        category=category,
        message=message,
        provider=provider,
        action=action,
        detail=safe_detail,
        status_code=status_code,
    )


def failure_from_status(
    status_code: int,
    provider: str | None,
    *,
    detail: str = "",
    secrets: Iterable[str | None] = (),
) -> ImageProviderFailure:
    """Classify an HTTP status from an image endpoint.

    Status wins over wording. ``429`` is a rate limit even when the body says
    "quota", and ``402`` is billing even when the body says "limit", because
    those are the two a user most needs told apart.
    """
    category = _STATUS_CATEGORIES.get(status_code)
    if category is None:
        category = "network" if status_code >= 500 else "unknown"
    return image_failure(
        category,
        provider,
        detail=redact_values(detail, secrets),
        status_code=status_code,
    )


def failure_from_exception(
    error: BaseException,
    provider: str | None,
    *,
    secrets: Iterable[str | None] = (),
) -> ImageProviderFailure:
    """Turn any exception raised while generating one image into a failure."""
    if isinstance(error, ImageProviderFailure):
        return error

    if isinstance(error, (TimeoutError,)):
        return image_failure(
            "network",
            provider,
            detail=redact_values(str(error) or "timed out", secrets),
            headline=f"{image_provider_label(provider)} timed out.",
        )

    info: ProviderErrorInfo = classify_provider_error(error, provider)
    return image_failure(
        info.category,
        provider,
        detail=redact_values(info.detail, secrets),
    )
