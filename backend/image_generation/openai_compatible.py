"""A generic OpenAI-compatible image endpoint.

Points at any server that implements the OpenAI images API: OpenAI itself,
Azure OpenAI, a proxy, or a local server such as one wrapping Stable
Diffusion. Because "OpenAI-compatible" is a family rather than a spec, this
module assumes only what the API reference actually defines::

    POST {base_url}/images/generations  {"model": ..., "prompt": ..., "n": 1}
    POST {base_url}/images/edits        multipart: image, prompt, model

and reads the response through the shared adapter, which accepts either
``data[].url`` or ``data[].b64_json`` - servers differ, and some return only
one of them.

Editing is *capability-gated, not assumed*. Many compatible servers implement
generations and nothing else, so a 404/405 from ``/images/edits`` is reported
as "this endpoint does not support editing" rather than as a failure the user
should try to fix. Nothing here fabricates background removal: that has no
endpoint in this API and stays Replicate-only.
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

PROVIDER_ID = "openai-compatible"

REQUEST_TIMEOUT_SECONDS = 180.0

# Status codes a server returns when the route simply is not implemented. They
# are a capability answer, not an error the user can act on by changing a key.
_UNIMPLEMENTED_STATUSES = frozenset({404, 405, 501})


class EndpointCapabilityMissing(ImageProviderFailure):
    """The endpoint answered, but it does not implement this operation."""


def _endpoint(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _headers(api_key: str | None) -> dict[str, str]:
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _capability_failure(operation: str) -> EndpointCapabilityMissing:
    message = (
        f"This OpenAI-compatible endpoint does not implement image {operation}. "
        "Point at a server that does, or use Replicate for this tool."
    )
    return EndpointCapabilityMissing(
        category="configuration",
        message=message,
        provider=PROVIDER_ID,
        action=(
            "Use a different image provider for this tool, or an endpoint that "
            f"implements /images/{operation}."
        ),
        detail="",
    )


async def _post(
    url: str,
    *,
    api_key: str | None,
    json: dict[str, Any] | None = None,
    files: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
    client: httpx.AsyncClient | None = None,
) -> httpx.Response:
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS)
    try:
        return await http.post(
            url, headers=_headers(api_key), json=json, files=files, data=data
        )
    except ImageProviderFailure:
        raise
    except Exception as error:
        raise failure_from_exception(
            error, PROVIDER_ID, secrets=(api_key,)
        ) from error
    finally:
        if owns_client:
            await http.aclose()


def _detail(response: httpx.Response) -> str:
    try:
        payload = cast(Any, response.json())
    except ValueError:
        return response.text[:400]
    if isinstance(payload, Mapping):
        error = cast(Mapping[str, Any], payload).get("error")
        if isinstance(error, Mapping):
            message = cast(Mapping[str, Any], error).get("message")
            if isinstance(message, str):
                return message[:400]
        if isinstance(error, str):
            return error[:400]
    return str(payload)[:400]


async def generate_image(
    prompt: str,
    *,
    base_url: str,
    api_key: str | None,
    model: str,
    asset_base_url: str,
    size: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> NormalizedImage:
    """Generate one image through ``POST {base_url}/images/generations``."""
    payload: dict[str, Any] = {"model": model, "prompt": prompt, "n": 1}
    if size:
        payload["size"] = size

    response = await _post(
        _endpoint(base_url, "images/generations"),
        api_key=api_key,
        json=payload,
        client=client,
    )

    if response.status_code in _UNIMPLEMENTED_STATUSES:
        raise _capability_failure("generations")
    if response.status_code >= 400:
        raise failure_from_status(
            response.status_code,
            PROVIDER_ID,
            detail=_detail(response),
            secrets=(api_key,),
        )

    try:
        body = cast(Any, response.json())
    except ValueError as error:
        raise image_failure(
            "unknown",
            PROVIDER_ID,
            detail="the endpoint returned a body that is not JSON",
        ) from error

    return await normalize_image_result(
        body, asset_base_url=asset_base_url, provider=PROVIDER_ID
    )


async def edit_image(
    prompt: str,
    *,
    image: tuple[bytes, str],
    base_url: str,
    api_key: str | None,
    model: str,
    asset_base_url: str,
    client: httpx.AsyncClient | None = None,
) -> NormalizedImage:
    """Edit one image through ``POST {base_url}/images/edits``.

    ``image`` is ``(bytes, mime_type)``: the images-edits route is multipart
    and takes a file, not a URL, so callers resolve their URL to bytes first.
    """
    image_bytes, mime_type = image
    response = await _post(
        _endpoint(base_url, "images/edits"),
        api_key=api_key,
        files={"image": ("image.png", image_bytes, mime_type)},
        data={"model": model, "prompt": prompt, "n": "1"},
        client=client,
    )

    if response.status_code in _UNIMPLEMENTED_STATUSES:
        raise _capability_failure("edits")
    if response.status_code >= 400:
        raise failure_from_status(
            response.status_code,
            PROVIDER_ID,
            detail=_detail(response),
            secrets=(api_key,),
        )

    try:
        body = cast(Any, response.json())
    except ValueError as error:
        raise image_failure(
            "unknown",
            PROVIDER_ID,
            detail="the endpoint returned a body that is not JSON",
        ) from error

    return await normalize_image_result(
        body, asset_base_url=asset_base_url, provider=PROVIDER_ID
    )


__all__ = [
    "EndpointCapabilityMissing",
    "PROVIDER_ID",
    "edit_image",
    "generate_image",
]
