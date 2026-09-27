"""Cloudflare Workers AI as an optional image-generation backend.

Additive: picking it changes nothing about Replicate, which stays the default
and stays the only background-removal backend. Workers AI is offered because it
is credentialed with an account ID plus an API token the user already has, and
because Cloudflare's own free Neuron allocation makes it a realistic option for
someone without a Replicate balance - *their* account allocation, set by
Cloudflare, not a guarantee from shot2code.

The REST shape is documented by Cloudflare as::

    POST /client/v4/accounts/{account_id}/ai/run/{model}
    {"prompt": "...", "steps": 4}

and ``@cf/black-forest-labs/flux-1-schnell`` answers with the image base64
encoded at ``result.image``. Some Workers AI image models answer with raw image
bytes and an ``image/*`` content type instead, so both are handled - the
adapter decides what the payload actually is rather than trusting a header.
"""

from __future__ import annotations

from typing import Any, Mapping, cast

import httpx

from image_generation.assets import NormalizedImage, normalize_image_result
from image_generation.errors import (
    ImageProviderFailure,
    failure_from_exception,
    failure_from_status,
    image_failure,
)

PROVIDER_ID = "cloudflare"

# flux-1-schnell caps diffusion steps at 8; 4 is Cloudflare's documented
# default and the cheapest setting that still looks like a finished image.
DEFAULT_STEPS = 4
MAX_STEPS = 8
MAX_PROMPT_LENGTH = 2048

REQUEST_TIMEOUT_SECONDS = 120.0


def build_input(prompt: str, *, steps: int = DEFAULT_STEPS) -> dict[str, Any]:
    return {
        "prompt": prompt[:MAX_PROMPT_LENGTH],
        "steps": max(1, min(steps, MAX_STEPS)),
    }


def _cloudflare_error_detail(payload: Mapping[str, Any]) -> str:
    """Cloudflare reports failures in ``errors`` even on a 200."""
    raw_errors = payload.get("errors")
    if not isinstance(raw_errors, list):
        return ""
    messages: list[str] = []
    for entry in cast(list[Any], raw_errors):
        if isinstance(entry, Mapping):
            message = cast(Mapping[str, Any], entry).get("message")
            if isinstance(message, str) and message:
                messages.append(message)
        elif isinstance(entry, str):
            messages.append(entry)
    return "; ".join(messages)


async def generate_image(
    prompt: str,
    *,
    account_id: str,
    api_token: str,
    model: str,
    asset_base_url: str,
    steps: int = DEFAULT_STEPS,
    client: httpx.AsyncClient | None = None,
) -> NormalizedImage:
    """Generate one image, or raise :class:`ImageProviderFailure`.

    Never returns a placeholder: a caller can rely on a returned value being a
    real, locally served image.
    """
    if not account_id or not api_token:
        raise image_failure(
            "credentials",
            PROVIDER_ID,
            detail="a Cloudflare account ID and API token are both required",
        )

    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS)
    try:
        response = await http.post(url, headers=headers, json=build_input(prompt, steps=steps))
    except ImageProviderFailure:
        raise
    except Exception as error:
        raise failure_from_exception(
            error, PROVIDER_ID, secrets=(api_token, account_id)
        ) from error
    finally:
        if owns_client:
            await http.aclose()

    if response.status_code >= 400:
        raise failure_from_status(
            response.status_code,
            PROVIDER_ID,
            detail=_response_detail(response),
            secrets=(api_token, account_id),
        )

    content_type = (response.headers.get("content-type") or "").lower()
    if content_type.startswith("image/"):
        return await normalize_image_result(
            response.content, asset_base_url=asset_base_url, provider=PROVIDER_ID
        )

    try:
        payload = cast(Any, response.json())
    except ValueError as error:
        raise image_failure(
            "unknown",
            PROVIDER_ID,
            detail="Workers AI returned a body that is neither an image nor JSON",
        ) from error

    if isinstance(payload, Mapping):
        mapping = cast(Mapping[str, Any], payload)
        if mapping.get("success") is False:
            detail = _cloudflare_error_detail(mapping)
            raise image_failure(
                "unknown",
                PROVIDER_ID,
                detail=detail or "Workers AI reported the request as unsuccessful",
            )

    return await normalize_image_result(
        payload, asset_base_url=asset_base_url, provider=PROVIDER_ID
    )


def _response_detail(response: httpx.Response) -> str:
    try:
        payload = cast(Any, response.json())
    except ValueError:
        return response.text[:400]
    if isinstance(payload, Mapping):
        detail = _cloudflare_error_detail(cast(Mapping[str, Any], payload))
        if detail:
            return detail
    return str(payload)[:400]


__all__ = ["PROVIDER_ID", "build_input", "generate_image"]
