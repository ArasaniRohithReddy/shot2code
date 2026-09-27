"""Replicate: the default image backend, and the only one doing background removal.

Two things changed here and both are about honesty.

**Failures are classified, not flattened.** ``_run_prediction`` used to turn
every HTTP status, timeout and malformed body into the same ``ValueError``,
which the batch layer then turned into ``None`` and reported as a success. Now
a 429 is a rate limit, a 402 is billing, a 401 is credentials and a poll that
runs out is a timeout - each an :class:`ImageProviderFailure` the caller
reports per prompt.

**A custom model is checked before it is used, not claimed to work.** Replicate
hosts thousands of image models with incompatible input schemas, so this module
does not assert that an arbitrary model works with the request bodies we build.
Instead :func:`validate_model_schema` reads the model's own OpenAPI schema from
``GET /v1/models/{owner}/{name}`` and accepts it only if it really does take a
string ``prompt`` and return something image-shaped.
"""

import asyncio
from typing import Any, Literal, Mapping, cast

import httpx

from image_generation.catalog import (
    FLUX_2_KLEIN_MODEL_PATH,
    P_IMAGE_EDIT_MODEL_PATH,
    Z_IMAGE_TURBO_MODEL_PATH,
)
from image_generation.errors import (
    ImageProviderFailure,
    failure_from_exception,
    failure_from_status,
    image_failure,
)

PROVIDER_ID = "replicate"

REPLICATE_API_BASE_URL = "https://api.replicate.com/v1"
ReplicateImageModel = Literal["z_image_turbo", "flux_2_klein"]
PImageEditAspectRatio = Literal[
    "match_input_image", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"
]
P_IMAGE_EDIT_ASPECT_RATIOS: tuple[PImageEditAspectRatio, ...] = (
    "match_input_image",
    "1:1",
    "16:9",
    "9:16",
    "4:3",
    "3:4",
    "3:2",
    "2:3",
)
MODEL_PATHS: dict[ReplicateImageModel, str] = {
    "z_image_turbo": Z_IMAGE_TURBO_MODEL_PATH,
    "flux_2_klein": FLUX_2_KLEIN_MODEL_PATH,
}
DEFAULT_IMAGE_MODEL: ReplicateImageModel = "z_image_turbo"
REMOVE_BACKGROUND_VERSION = (
    "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc"
)
POLL_INTERVAL_SECONDS = 0.1
MAX_POLLS = 100

# Input names a text-to-image model must expose for the request bodies this
# codebase builds to mean anything.
REQUIRED_INPUT_FIELD = "prompt"
# Output shapes that carry an image: a URI string, a list of them, or an object
# whose properties include one.
_IMAGE_FORMATS = {"uri", "url", "binary", "byte"}

SCHEMA_TIMEOUT_SECONDS = 20.0


def _build_headers(api_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }


def _extract_prediction_id(response_json: Mapping[str, Any]) -> str:
    prediction_id = response_json.get("id")
    if not isinstance(prediction_id, str) or not prediction_id:
        raise image_failure(
            "unknown",
            PROVIDER_ID,
            detail="the prediction response carried no prediction id",
        )
    return prediction_id


async def _poll_prediction(
    client: httpx.AsyncClient, prediction_id: str, headers: dict[str, str]
) -> dict[str, Any]:
    status_check_url = f"{REPLICATE_API_BASE_URL}/predictions/{prediction_id}"

    for _ in range(MAX_POLLS):
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        status_response = await client.get(status_check_url, headers=headers)
        if status_response.status_code >= 400:
            raise failure_from_status(
                status_response.status_code,
                PROVIDER_ID,
                detail=status_response.text[:400],
            )
        status_response_raw: Any = status_response.json()
        if not isinstance(status_response_raw, dict):
            raise image_failure(
                "unknown", PROVIDER_ID, detail="malformed prediction status response"
            )
        status_response_json = cast(dict[str, Any], status_response_raw)

        status = status_response_json.get("status")
        if status == "succeeded":
            return cast(dict[str, Any], status_response_json)
        if status in {"error", "failed"}:
            detail = str(status_response_json.get("error") or "the prediction failed")
            # Replicate reports out-of-credit and rate-limit conditions in the
            # prediction body as well as the status line, so classify the text.
            raise failure_from_exception(RuntimeError(detail), PROVIDER_ID)
        if status == "canceled":
            raise image_failure(
                "unknown", PROVIDER_ID, detail="the prediction was canceled"
            )

    raise image_failure(
        "network",
        PROVIDER_ID,
        detail=(
            "the prediction was still running after "
            f"{MAX_POLLS * POLL_INTERVAL_SECONDS:.0f}s"
        ),
        headline="Replicate did not finish the image in time.",
    )


async def _run_prediction(
    endpoint_url: str, payload: dict[str, Any], api_token: str
) -> Any:
    headers = _build_headers(api_token)

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(endpoint_url, headers=headers, json=payload)
            if response.status_code >= 400:
                raise failure_from_status(
                    response.status_code,
                    PROVIDER_ID,
                    detail=response.text[:400],
                    secrets=(api_token,),
                )
            response_json = response.json()
            if not isinstance(response_json, dict):
                raise image_failure(
                    "unknown",
                    PROVIDER_ID,
                    detail="malformed prediction creation response",
                )

            prediction_id = _extract_prediction_id(
                cast(Mapping[str, Any], response_json)
            )
            final_response = await _poll_prediction(client, prediction_id, headers)
            return final_response.get("output")
        except ImageProviderFailure:
            raise
        except Exception as exc:
            raise failure_from_exception(
                exc, PROVIDER_ID, secrets=(api_token,)
            ) from exc


def _extract_output_url(result: Any, context: str) -> str:
    if isinstance(result, str) and result:
        return result

    if isinstance(result, dict):
        url = cast(Any, cast(dict[str, Any], result).get("url"))
        if isinstance(url, str) and url:
            return url

    if isinstance(result, list) and len(cast(list[Any], result)) > 0:
        first = cast(Any, cast(list[Any], result)[0])
        if isinstance(first, str) and first:
            return first
        if isinstance(first, Mapping):
            url = cast(Any, cast(Mapping[str, Any], first).get("url"))
            if isinstance(url, str) and url:
                return url

    raise image_failure(
        "unknown", PROVIDER_ID, detail=f"unexpected response from {context}"
    )


async def call_replicate_model(
    model_path: str, input: dict[str, Any], api_token: str
) -> Any:
    return await _run_prediction(
        f"{REPLICATE_API_BASE_URL}/models/{model_path}/predictions",
        {"input": input},
        api_token,
    )


async def call_replicate_version(
    version: str, input: dict[str, Any], api_token: str
) -> Any:
    return await _run_prediction(
        f"{REPLICATE_API_BASE_URL}/predictions",
        {"version": version, "input": input},
        api_token,
    )


async def remove_background(image_url: str, api_token: str) -> str:
    result = await call_replicate_version(
        REMOVE_BACKGROUND_VERSION,
        {
            "image": image_url,
            "format": "png",
            "reverse": False,
            "threshold": 0,
            "background_type": "rgba",
        },
        api_token,
    )
    return _extract_output_url(result, "background remover")


async def edit_image(
    prompt: str,
    image_urls: list[str],
    api_token: str,
    *,
    aspect_ratio: PImageEditAspectRatio = "match_input_image",
) -> str:
    input: dict[str, Any] = {
        "prompt": prompt,
        "images": image_urls,
        "turbo": True,
        "aspect_ratio": aspect_ratio,
    }

    result = await call_replicate_model(P_IMAGE_EDIT_MODEL_PATH, input, api_token)
    return _extract_output_url(result, "Replicate image edit model prediction")


async def call_replicate(
    input: dict[str, str | int | float | bool],
    api_token: str,
    model: ReplicateImageModel = DEFAULT_IMAGE_MODEL,
) -> str:
    result = await call_replicate_model(MODEL_PATHS[model], input, api_token)
    return _extract_output_url(result, f"Replicate image model prediction ({model})")


async def call_replicate_path(
    input: dict[str, Any], api_token: str, model_path: str
) -> str:
    """Run any Replicate model path, for custom models that passed validation."""
    result = await call_replicate_model(model_path, input, api_token)
    return _extract_output_url(
        result, f"Replicate image model prediction ({model_path})"
    )


# --------------------------------------------------------------------------- #
# Custom model validation
# --------------------------------------------------------------------------- #


def _component_schema(schema: Mapping[str, Any], name: str) -> Mapping[str, Any]:
    components = schema.get("components")
    if not isinstance(components, Mapping):
        return {}
    schemas = cast(Mapping[str, Any], components).get("schemas")
    if not isinstance(schemas, Mapping):
        return {}
    target = cast(Mapping[str, Any], schemas).get(name)
    if not isinstance(target, Mapping):
        return {}
    return cast(Mapping[str, Any], target)


def _looks_like_image_output(output_schema: Mapping[str, Any]) -> bool:
    """Whether an Output schema can carry an image.

    Replicate models describe an image as a ``uri``-formatted string, an array
    of them, or an object with such a property. Anything else (a plain string,
    a number, a bare object of scalars) is a model that does not return an
    image and must not be accepted as one.
    """
    if not output_schema:
        # Some models omit an Output schema entirely; that is not evidence of
        # an image, so it is refused rather than assumed.
        return False

    schema_type = output_schema.get("type")
    if schema_type == "string":
        return str(output_schema.get("format", "")).lower() in _IMAGE_FORMATS
    if schema_type == "array":
        items = output_schema.get("items")
        if isinstance(items, Mapping):
            return _looks_like_image_output(cast(Mapping[str, Any], items))
        return False
    if schema_type == "object":
        properties = output_schema.get("properties")
        if isinstance(properties, Mapping):
            return any(
                isinstance(value, Mapping)
                and _looks_like_image_output(cast(Mapping[str, Any], value))
                for value in cast(Mapping[str, Any], properties).values()
            )
    return False


class ModelSchemaResult:
    """The verdict on a custom model, with a reason either way."""

    def __init__(self, ok: bool, message: str, model: str) -> None:
        self.ok = ok
        self.message = message
        self.model = model

    def to_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "message": self.message, "model": self.model}


def check_model_schema(
    model_path: str, payload: Mapping[str, Any]
) -> ModelSchemaResult:
    """Decide whether a model's own OpenAPI schema is one we can drive.

    Pure, so the rule is testable without a network call: the request body this
    codebase builds sets ``prompt``, therefore the model must declare a string
    ``prompt`` input, and it must declare an image-shaped output.
    """
    latest = payload.get("latest_version")
    if not isinstance(latest, Mapping):
        return ModelSchemaResult(
            False,
            "Replicate has no published version for this model, so its input "
            "schema cannot be checked.",
            model_path,
        )

    schema = cast(Mapping[str, Any], latest).get("openapi_schema")
    if not isinstance(schema, Mapping):
        return ModelSchemaResult(
            False,
            "This model does not publish an OpenAPI schema, so shot2code "
            "cannot confirm it accepts a text prompt.",
            model_path,
        )

    input_schema = _component_schema(cast(Mapping[str, Any], schema), "Input")
    properties = input_schema.get("properties")
    if not isinstance(properties, Mapping):
        return ModelSchemaResult(
            False, "This model publishes no input properties.", model_path
        )

    prompt_property = cast(Mapping[str, Any], properties).get(REQUIRED_INPUT_FIELD)
    if not isinstance(prompt_property, Mapping):
        return ModelSchemaResult(
            False,
            "This model has no 'prompt' input, so it is not a text-to-image "
            "model shot2code can drive.",
            model_path,
        )
    if cast(Mapping[str, Any], prompt_property).get("type") not in (None, "string"):
        return ModelSchemaResult(
            False, "This model's 'prompt' input is not a string.", model_path
        )

    output_schema = _component_schema(cast(Mapping[str, Any], schema), "Output")
    if not _looks_like_image_output(output_schema):
        return ModelSchemaResult(
            False,
            "This model does not declare an image output, so shot2code cannot "
            "use what it returns.",
            model_path,
        )

    required = input_schema.get("required")
    unmet: list[str] = []
    if isinstance(required, list):
        unmet = [
            name
            for name in cast(list[Any], required)
            if isinstance(name, str) and name != REQUIRED_INPUT_FIELD
        ]
    if unmet:
        return ModelSchemaResult(
            False,
            "This model requires inputs shot2code does not send: "
            + ", ".join(sorted(unmet)[:5])
            + ".",
            model_path,
        )

    return ModelSchemaResult(
        True,
        "This model takes a text prompt and returns an image, so it can be "
        "used for placeholder images. Replicate bills you at this model's own "
        "rate.",
        model_path,
    )


async def fetch_model_schema(
    model_path: str,
    api_token: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> Mapping[str, Any]:
    """Read ``GET /v1/models/{owner}/{name}``."""
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=SCHEMA_TIMEOUT_SECONDS)
    try:
        response = await http.get(
            f"{REPLICATE_API_BASE_URL}/models/{model_path}",
            headers=_build_headers(api_token),
        )
    except ImageProviderFailure:
        raise
    except Exception as error:
        raise failure_from_exception(
            error, PROVIDER_ID, secrets=(api_token,)
        ) from error
    finally:
        if owns_client:
            await http.aclose()

    if response.status_code >= 400:
        raise failure_from_status(
            response.status_code,
            PROVIDER_ID,
            detail=response.text[:400],
            secrets=(api_token,),
        )
    payload = cast(Any, response.json())
    if not isinstance(payload, Mapping):
        raise image_failure("unknown", PROVIDER_ID, detail="malformed model description")
    return cast(Mapping[str, Any], payload)


async def validate_model_schema(
    model_path: str,
    api_token: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> ModelSchemaResult:
    """Fetch a custom model's schema and decide whether it is usable."""
    payload = await fetch_model_schema(model_path, api_token, client=client)
    return check_model_schema(model_path, payload)
