"""What a user may pick as an image model, and what we honestly know about it.

This is the image-side twin of ``model_catalog.py``: a pure description of the
options, with no credentials in it and no network calls. Three rules shaped it.

**Only models whose input schema this code actually builds are listed.**
Replicate hosts thousands of image models and they do not share an input
schema - ``prunaai/z-image-turbo`` takes ``width``/``height``/
``num_inference_steps`` while ``black-forest-labs/flux-2-klein-4b`` takes
``aspect_ratio``. Listing a third model we have never sent a request to would
be a claim we cannot support, so custom Replicate models go through
:func:`image_generation.replicate.validate_model_schema`, which reads the
model's own OpenAPI schema from Replicate before it is accepted.

**Cost wording is attributed, dated and hedged - never a bare number.** A
figure with no source ages into a lie, but so does vagueness: "free" with no
qualifier is the worst of both. So each entry names who bills, quotes the
provider's own published figure with the date it was read, links that
provider's pricing page, and says the terms can change. **No entry may
describe any provider as permanently free**, and an allowance is always
attributed to the provider, scoped (daily/monthly) and marked subject to
account and model availability.

**A free allocation is an account quota, not a promise.** Cloudflare's Workers
AI allocation belongs to the user's Cloudflare account, is 10,000 Neurons a day
on *both* the Free and Paid plans, resets at 00:00 UTC, and can change or run
out mid-run. It is described that way here and in the UI; nothing in shot2code
guarantees free image generation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


ImageProvider = Literal["replicate", "cloudflare", "openai-compatible"]

IMAGE_PROVIDERS: tuple[ImageProvider, ...] = (
    "replicate",
    "cloudflare",
    "openai-compatible",
)

DEFAULT_IMAGE_PROVIDER: ImageProvider = "replicate"

# Replicate model ids, kept as the canonical strings the API expects.
Z_IMAGE_TURBO_MODEL_PATH = "prunaai/z-image-turbo"
FLUX_2_KLEIN_MODEL_PATH = "black-forest-labs/flux-2-klein-4b"
P_IMAGE_EDIT_MODEL_PATH = "prunaai/p-image-edit"

CLOUDFLARE_FLUX_SCHNELL_MODEL = "@cf/black-forest-labs/flux-1-schnell"

DEFAULT_OPENAI_COMPATIBLE_MODEL = "gpt-image-1"


@dataclass(frozen=True)
class ImageModelInfo:
    """One selectable image model.

    ``cost_note`` is shown verbatim in Settings. It says who bills and where to
    check, never a figure, because a figure here ages into a lie.
    """

    id: str
    provider: ImageProvider
    label: str
    cost_note: str
    pricing_url: str
    # The input schema shape this codebase builds for the model. Two Replicate
    # models with different shapes cannot share one entry.
    input_shape: Literal["z_image", "flux_aspect", "cloudflare_flux", "openai_images"]
    supports_editing: bool = False
    supports_background_removal: bool = False


REPLICATE_PRICING_URL = "https://replicate.com/pricing"
CLOUDFLARE_PRICING_URL = "https://developers.cloudflare.com/workers-ai/platform/pricing/"

# When the figures below were read off the official pages. A quoted number is
# only honest with a date attached, because the provider can change it the day
# after this file is written.
CLOUDFLARE_PRICING_CHECKED = "2026-09-17"
REPLICATE_PRICING_CHECKED = "2026-09-27"

# Wording reused by the UI. Kept here so the backend and the settings screen
# cannot drift into describing the same allocation differently.
#
# Every clause is load-bearing and checked against Cloudflare's own pricing
# page: the allocation is 10,000 Neurons a day on *both* the Workers Free and
# Workers Paid plans (not Free only), it resets at 00:00 UTC, going beyond it
# needs the Paid plan, and some models require a paid billing method at all.
# Nothing here may call it "free" without the qualifiers: it is Cloudflare's
# allocation on Cloudflare's terms, and it can change.
CLOUDFLARE_ALLOCATION_NOTE = (
    "Billed to your Cloudflare account. Cloudflare's published pricing "
    f"(checked {CLOUDFLARE_PRICING_CHECKED}) includes a daily free allocation "
    "of 10,000 Neurons on both the Workers Free and Workers Paid plans, "
    "resetting at 00:00 UTC, which image generation draws from. Going beyond "
    "it requires the Workers Paid plan and is billed at $0.011 per 1,000 "
    "Neurons. The allocation, the rates and model availability are set by "
    "Cloudflare and can change; some models require a paid billing method."
)

# The per-image cost, in the provider's own unit, for the model shot2code
# actually calls. shot2code pins 4 steps, so one 1024x1024 image is roughly
# 4 tiles x 4.80 + 4 steps x 9.60 neurons - small against the daily
# allocation, but not zero, and the arithmetic is the user's to check.
CLOUDFLARE_FLUX_SCHNELL_COST_NOTE = (
    "Cloudflare prices this model at 4.80 neurons per 512x512 tile plus 9.60 "
    "neurons per step, and shot2code requests 4 steps."
)

REPLICATE_COST_NOTE = (
    "Billed by Replicate, which charges only for what you use; the cost of a "
    "public model depends on the model and how long each run takes, and is "
    "listed on that model's own page. There is no free allocation."
)

OPENAI_COMPATIBLE_COST_NOTE = (
    "Billed by whoever runs the endpoint you point at. A local server usually "
    "costs nothing; a hosted one bills you at its own rate."
)

BUILT_IN_IMAGE_MODELS: tuple[ImageModelInfo, ...] = (
    ImageModelInfo(
        id=Z_IMAGE_TURBO_MODEL_PATH,
        provider="replicate",
        label="Z-Image Turbo (Pruna)",
        cost_note=REPLICATE_COST_NOTE,
        pricing_url=REPLICATE_PRICING_URL,
        input_shape="z_image",
    ),
    ImageModelInfo(
        id=FLUX_2_KLEIN_MODEL_PATH,
        provider="replicate",
        label="FLUX.2 Klein 4B (Black Forest Labs)",
        cost_note=REPLICATE_COST_NOTE,
        pricing_url=REPLICATE_PRICING_URL,
        input_shape="flux_aspect",
    ),
    ImageModelInfo(
        id=CLOUDFLARE_FLUX_SCHNELL_MODEL,
        provider="cloudflare",
        label="FLUX.1 [schnell] (Workers AI)",
        cost_note=f"{CLOUDFLARE_ALLOCATION_NOTE} {CLOUDFLARE_FLUX_SCHNELL_COST_NOTE}",
        pricing_url=CLOUDFLARE_PRICING_URL,
        input_shape="cloudflare_flux",
    ),
    ImageModelInfo(
        id=DEFAULT_OPENAI_COMPATIBLE_MODEL,
        provider="openai-compatible",
        label="OpenAI-compatible images endpoint",
        cost_note=OPENAI_COMPATIBLE_COST_NOTE,
        pricing_url="https://platform.openai.com/docs/api-reference/images",
        input_shape="openai_images",
    ),
)

DEFAULT_MODEL_FOR_PROVIDER: dict[ImageProvider, str] = {
    "replicate": Z_IMAGE_TURBO_MODEL_PATH,
    "cloudflare": CLOUDFLARE_FLUX_SCHNELL_MODEL,
    "openai-compatible": DEFAULT_OPENAI_COMPATIBLE_MODEL,
}

# Only Replicate has a background-removal model wired up here, and only
# Replicate's editing model has been run against this code. The other providers
# are generation-only on purpose: reporting an unsupported capability as
# available would produce a tool the runtime cannot honour.
BACKGROUND_REMOVAL_PROVIDERS: tuple[ImageProvider, ...] = ("replicate",)
EDITING_PROVIDERS: tuple[ImageProvider, ...] = ("replicate", "openai-compatible")


def models_for_provider(provider: ImageProvider) -> tuple[ImageModelInfo, ...]:
    return tuple(model for model in BUILT_IN_IMAGE_MODELS if model.provider == provider)


def find_model(provider: ImageProvider, model_id: str) -> ImageModelInfo | None:
    for model in BUILT_IN_IMAGE_MODELS:
        if model.provider == provider and model.id == model_id:
            return model
    return None


def default_model_for(provider: ImageProvider) -> str:
    return DEFAULT_MODEL_FOR_PROVIDER[provider]


def supports_background_removal(provider: ImageProvider) -> bool:
    """Whether ``remove_backgrounds`` can actually run on this provider.

    A provider that cannot do it is told so; no other provider's background
    removal is substituted, and nothing pretends the call succeeded.
    """
    return provider in BACKGROUND_REMOVAL_PROVIDERS


def supports_editing(provider: ImageProvider) -> bool:
    return provider in EDITING_PROVIDERS


__all__ = [
    "BUILT_IN_IMAGE_MODELS",
    "CLOUDFLARE_ALLOCATION_NOTE",
    "CLOUDFLARE_FLUX_SCHNELL_COST_NOTE",
    "CLOUDFLARE_FLUX_SCHNELL_MODEL",
    "CLOUDFLARE_PRICING_CHECKED",
    "CLOUDFLARE_PRICING_URL",
    "DEFAULT_IMAGE_PROVIDER",
    "DEFAULT_OPENAI_COMPATIBLE_MODEL",
    "FLUX_2_KLEIN_MODEL_PATH",
    "IMAGE_PROVIDERS",
    "ImageModelInfo",
    "ImageProvider",
    "P_IMAGE_EDIT_MODEL_PATH",
    "REPLICATE_COST_NOTE",
    "REPLICATE_PRICING_CHECKED",
    "REPLICATE_PRICING_URL",
    "Z_IMAGE_TURBO_MODEL_PATH",
    "default_model_for",
    "find_model",
    "models_for_provider",
    "supports_background_removal",
    "supports_editing",
]
