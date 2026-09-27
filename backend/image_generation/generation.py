"""Batch image generation that tells the truth about what happened.

The old ``process_tasks`` returned ``list[str | None]``. Every failure - a
rate limit, an expired key, a timeout, a malformed response - collapsed into
the same ``None``, the caller mapped that to ``{"url": None, "status":
"error"}`` and still returned ``ok=True``, and the UI counted the ``None``s as
generated images. A run that produced nothing looked like a success with blank
tiles.

So the unit of work here is :class:`ImageResult`: one per prompt, either an
image or a classified :class:`ImageProviderFailure`. Nothing is dropped,
nothing is invented, and :class:`BatchImageResult` knows how many actually
succeeded so a caller can say "Generated 2 of 5" instead of "Generated 5".

Dispatch is a single branch on the configured provider. Replicate remains the
default and its request bodies are unchanged, so an existing install that sends
no image settings generates exactly the images it did before.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, List, Sequence, Union

from image_generation.assets import NormalizedImage, normalize_image_result
from image_generation.catalog import (
    FLUX_2_KLEIN_MODEL_PATH,
    Z_IMAGE_TURBO_MODEL_PATH,
    find_model,
)
from image_generation.errors import (
    ImageProviderFailure,
    failure_from_exception,
    image_failure,
)
from image_generation.replicate import (
    DEFAULT_IMAGE_MODEL,
    ReplicateImageModel,
    call_replicate,
    call_replicate_path,
)
from image_generation.settings import ImageGenerationSettings

REPLICATE_BATCH_SIZE = 20
REPLICATE_IMAGE_MODEL: ReplicateImageModel = DEFAULT_IMAGE_MODEL


@dataclass(frozen=True)
class ImageResult:
    """One prompt's outcome. Exactly one of ``image`` / ``failure`` is set."""

    prompt: str
    image: NormalizedImage | None = None
    failure: ImageProviderFailure | None = None

    @property
    def ok(self) -> bool:
        return self.image is not None

    @property
    def url(self) -> str | None:
        return self.image.url if self.image else None

    def to_dict(self) -> dict[str, Any]:
        if self.image is not None:
            return {"prompt": self.prompt, "url": self.image.url, "status": "ok"}
        failure = self.failure
        payload: dict[str, Any] = {
            "prompt": self.prompt,
            "url": None,
            "status": "error",
        }
        if failure is not None:
            payload["error"] = failure.message
            payload["errorCategory"] = failure.category
            payload["action"] = failure.action or ""
            payload["retryable"] = failure.is_retryable
        return payload


@dataclass(frozen=True)
class BatchImageResult:
    """Every prompt's outcome, plus the counts a caller must not guess."""

    results: tuple[ImageResult, ...] = field(default_factory=tuple)

    @property
    def succeeded(self) -> tuple[ImageResult, ...]:
        return tuple(result for result in self.results if result.ok)

    @property
    def failed(self) -> tuple[ImageResult, ...]:
        return tuple(result for result in self.results if not result.ok)

    @property
    def success_count(self) -> int:
        return len(self.succeeded)

    @property
    def requested_count(self) -> int:
        return len(self.results)

    @property
    def all_failed(self) -> bool:
        return self.requested_count > 0 and self.success_count == 0

    @property
    def partial(self) -> bool:
        return 0 < self.success_count < self.requested_count

    def summary_message(self) -> str:
        """What the run actually did, in one sentence.

        Never claims more images than exist: ``Generated 2 of 5 images`` is the
        wording a partial batch gets, and a batch with no images says so.
        """
        total = self.requested_count
        if total == 0:
            return "No prompts were provided."
        if self.success_count == 0:
            return f"Generated 0 of {total} image{'s' if total != 1 else ''}."
        if self.success_count == total:
            return f"Generated {total} image{'s' if total != 1 else ''}."
        return f"Generated {self.success_count} of {total} images."

    def dominant_failure(self) -> ImageProviderFailure | None:
        """The failure worth showing when the whole batch went wrong."""
        failures = [
            result.failure for result in self.failed if result.failure is not None
        ]
        return failures[0] if failures else None


def replicate_input_for(model_path: str, prompt: str) -> dict[str, Any]:
    """The request body a known Replicate model expects.

    The two built-in models take different inputs, which is exactly why an
    arbitrary Replicate model cannot be assumed compatible.
    """
    if model_path == FLUX_2_KLEIN_MODEL_PATH:
        return {
            "prompt": prompt,
            "aspect_ratio": "1:1",
            "output_format": "png",
        }
    if model_path == Z_IMAGE_TURBO_MODEL_PATH:
        return {
            "prompt": prompt,
            "width": 1024,
            "height": 1024,
            "go_fast": False,
            "output_format": "png",
            "guidance_scale": 0,
            "num_inference_steps": 8,
        }
    # A custom model that passed schema validation: send only the one input we
    # know it declares, rather than guessing at its other parameters.
    return {"prompt": prompt}


async def _generate_replicate(
    prompt: str, settings: ImageGenerationSettings, asset_base_url: str
) -> NormalizedImage:
    api_key = settings.replicate_api_key
    if not api_key:
        raise image_failure(
            "credentials", "replicate", detail="no Replicate API key is configured"
        )

    model_path = settings.model_id
    payload = replicate_input_for(model_path, prompt)
    if find_model("replicate", model_path) is not None:
        legacy_key: ReplicateImageModel = (
            "flux_2_klein" if model_path == FLUX_2_KLEIN_MODEL_PATH else "z_image_turbo"
        )
        url = await call_replicate(payload, api_key, model=legacy_key)
    else:
        url = await call_replicate_path(payload, api_key, model_path)

    return await normalize_image_result(
        url, asset_base_url=asset_base_url, provider="replicate"
    )


async def _generate_cloudflare(
    prompt: str, settings: ImageGenerationSettings, asset_base_url: str
) -> NormalizedImage:
    from image_generation import cloudflare

    return await cloudflare.generate_image(
        prompt,
        account_id=settings.cloudflare_account_id or "",
        api_token=settings.cloudflare_api_token or "",
        model=settings.model_id,
        asset_base_url=asset_base_url,
    )


async def _generate_openai_compatible(
    prompt: str, settings: ImageGenerationSettings, asset_base_url: str
) -> NormalizedImage:
    from image_generation import openai_compatible

    base_url = settings.openai_image_base_url
    if not base_url:
        raise image_failure(
            "configuration",
            "openai-compatible",
            detail="no image endpoint URL is configured",
        )
    return await openai_compatible.generate_image(
        prompt,
        base_url=base_url,
        api_key=settings.openai_image_api_key,
        model=settings.openai_image_model or settings.model_id,
        asset_base_url=asset_base_url,
    )


async def generate_one(
    prompt: str, settings: ImageGenerationSettings, asset_base_url: str
) -> NormalizedImage:
    """Generate a single image on the configured provider, or raise."""
    if settings.provider == "cloudflare":
        return await _generate_cloudflare(prompt, settings, asset_base_url)
    if settings.provider == "openai-compatible":
        return await _generate_openai_compatible(prompt, settings, asset_base_url)
    return await _generate_replicate(prompt, settings, asset_base_url)


async def generate_images(
    prompts: Sequence[str],
    settings: ImageGenerationSettings,
    *,
    asset_base_url: str = "",
    batch_size: int | None = None,
) -> BatchImageResult:
    """Generate every prompt, keeping each prompt's own outcome.

    ``asyncio.gather(..., return_exceptions=True)`` is still how the fan-out
    works, but an exception is now classified and attached to its prompt rather
    than discarded.
    """
    cleaned = list(prompts)
    if not cleaned:
        return BatchImageResult(())

    started = time.time()
    results: list[ImageResult] = []
    # Read the module constant at call time so a test (or a deployment) can
    # change the fan-out width without rebinding a default argument.
    size = max(1, batch_size if batch_size is not None else REPLICATE_BATCH_SIZE)
    for offset in range(0, len(cleaned), size):
        batch = cleaned[offset : offset + size]
        raw = await asyncio.gather(
            *(generate_one(prompt, settings, asset_base_url) for prompt in batch),
            return_exceptions=True,
        )
        for prompt, outcome in zip(batch, raw):
            if isinstance(outcome, BaseException):
                failure = failure_from_exception(
                    outcome, settings.provider, secrets=settings.secrets()
                )
                print(f"Image generation failed for {prompt!r}: {failure.category}")
                results.append(ImageResult(prompt=prompt, failure=failure))
            else:
                results.append(ImageResult(prompt=prompt, image=outcome))

    print(f"Image generation time: {time.time() - started:.2f} seconds")
    return BatchImageResult(tuple(results))


async def process_tasks(
    prompts: List[str],
    api_key: str,
    _base_url: str | None,
    _model: str,
) -> List[Union[str, None]]:
    """Back-compatible shim for callers that only want URLs.

    Kept so evals and any external caller keep working. It deliberately loses
    the failure detail, which is why nothing inside the agent runtime uses it
    any more - :func:`generate_images` is the honest entry point.
    """
    settings = ImageGenerationSettings(replicate_api_key=api_key)
    batch = await generate_images(prompts, settings)
    return [result.url for result in batch.results]


async def generate_image_replicate(prompt: str, api_key: str) -> str:
    """Generate one image on Replicate with the historical defaults."""
    settings = ImageGenerationSettings(replicate_api_key=api_key)
    image = await _generate_replicate(prompt, settings, "")
    return image.url


__all__ = [
    "BatchImageResult",
    "ImageResult",
    "REPLICATE_BATCH_SIZE",
    "REPLICATE_IMAGE_MODEL",
    "generate_image_replicate",
    "generate_images",
    "generate_one",
    "process_tasks",
    "replicate_input_for",
]
