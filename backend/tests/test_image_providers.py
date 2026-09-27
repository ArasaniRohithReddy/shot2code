"""Image provider configuration: what a user may pick, and what is refused.

Two invariants run through all of it. Replicate stays the default and is never
disturbed by another provider being configured, and a model or endpoint is only
accepted when there is a reason to believe it works.
"""

from typing import Any
from pathlib import Path

import httpx
import pytest

from image_generation import replicate
from image_generation.catalog import (
    BUILT_IN_IMAGE_MODELS,
    CLOUDFLARE_ALLOCATION_NOTE,
    CLOUDFLARE_FLUX_SCHNELL_MODEL,
    CLOUDFLARE_PRICING_CHECKED,
    FLUX_2_KLEIN_MODEL_PATH,
    IMAGE_PROVIDERS,
    Z_IMAGE_TURBO_MODEL_PATH,
    default_model_for,
    find_model,
    models_for_provider,
    supports_background_removal,
)
from image_generation.generation import replicate_input_for
from image_generation.settings import (
    ImageConfigError,
    ImageGenerationSettings,
    parse_image_settings,
)


# --------------------------------------------------------------------------- #
# Catalog
# --------------------------------------------------------------------------- #


def test_both_validated_replicate_models_are_selectable() -> None:
    ids = {model.id for model in models_for_provider("replicate")}
    assert ids == {Z_IMAGE_TURBO_MODEL_PATH, FLUX_2_KLEIN_MODEL_PATH}


def test_every_catalog_model_has_a_cost_note_and_a_pricing_link() -> None:
    for model in BUILT_IN_IMAGE_MODELS:
        assert model.cost_note.strip()
        assert model.pricing_url.startswith("https://")


def test_no_catalog_entry_describes_a_provider_as_permanently_free() -> None:
    # The rule that replaced "quote no figures": a number is fine when it is
    # attributed and dated, but a promise of permanence never is.
    forbidden = (
        "free forever",
        "always free",
        "permanently free",
        "unlimited",
        "no cost ever",
        "completely free",
    )
    for model in BUILT_IN_IMAGE_MODELS:
        lowered = model.cost_note.lower()
        for phrase in forbidden:
            assert phrase not in lowered, f"{model.id}: {phrase}"


def test_any_quoted_figure_is_dated_and_marked_changeable() -> None:
    """A price in the UI is only honest with a source and an expiry."""
    for model in BUILT_IN_IMAGE_MODELS:
        if "$" not in model.cost_note:
            continue
        lowered = model.cost_note.lower()
        assert "checked" in lowered, model.id
        assert "can change" in lowered, model.id


def test_cloudflare_allocation_matches_cloudflares_published_terms() -> None:
    """Verified against developers.cloudflare.com/workers-ai/platform/pricing.

    The earlier wording said the allocation was "on the Workers Free plan",
    which was wrong: Cloudflare publishes 10,000 Neurons a day on *both* the
    Workers Free and Workers Paid plans. These assertions exist so that claim
    cannot come back.
    """
    note = CLOUDFLARE_ALLOCATION_NOTE
    lowered = note.lower()

    assert "10,000 neurons" in lowered
    assert "both the workers free and workers paid plans" in lowered
    assert "00:00 utc" in lowered
    assert "$0.011 per 1,000 neurons" in lowered
    assert "workers paid plan" in lowered
    # Model availability is account-dependent; some models need a paid method.
    assert "paid billing method" in lowered
    # Attributed and hedged, never bare.
    assert "your cloudflare account" in lowered
    assert "can change" in lowered
    assert CLOUDFLARE_PRICING_CHECKED in note


def test_cloudflare_note_never_claims_the_allocation_is_free_plan_only() -> None:
    lowered = CLOUDFLARE_ALLOCATION_NOTE.lower()
    assert "on the workers free plan" not in lowered
    assert "free plan only" not in lowered


def test_the_cloudflare_model_quotes_its_own_published_rate() -> None:
    model = find_model("cloudflare", CLOUDFLARE_FLUX_SCHNELL_MODEL)
    assert model is not None
    # Cloudflare's published figures for flux-1-schnell, and the step count
    # shot2code actually sends.
    assert "4.80 neurons per 512x512 tile" in model.cost_note
    assert "9.60 neurons per step" in model.cost_note
    assert "4 steps" in model.cost_note


def test_cloudflare_allocation_note_matches_across_backend_and_frontend() -> None:
    """The UI mirrors this string; a drift would let one surface lie."""
    mirrored = Path("../frontend/src/lib/image-providers.ts").resolve()
    if not mirrored.is_file():
        pytest.skip("frontend sources not present")
    source = mirrored.read_text(encoding="utf-8")
    for fragment in (
        "10,000 Neurons on both the Workers Free and Workers Paid plans",
        "00:00 UTC",
        "$0.011 per 1,000 ",
        "paid billing method",
    ):
        assert fragment in source, fragment


def test_replicate_note_does_not_promise_a_free_tier() -> None:
    replicate_models = models_for_provider("replicate")
    for model in replicate_models:
        lowered = model.cost_note.lower()
        assert "no free allocation" in lowered
        # Replicate's own framing: pay only for what you use, per model.
        assert "only for what you use" in lowered
        assert model.pricing_url == "https://replicate.com/pricing"


def test_no_unverifiable_free_backend_is_listed() -> None:
    """Hugging Face, Gemini's unpaid tier and Pollinations are not options.

    Each fails the rule for its own reason - a nominal monthly credit, terms
    that allow training on unpaid content plus paid-only regions, and no
    published quota at all - so none of them is offered as a free backend.
    """
    listed = {model.provider for model in BUILT_IN_IMAGE_MODELS}
    assert listed == {"replicate", "cloudflare", "openai-compatible"}
    for model in BUILT_IN_IMAGE_MODELS:
        lowered = f"{model.id} {model.label} {model.cost_note}".lower()
        for absent in ("hugging face", "huggingface", "pollinations"):
            assert absent not in lowered


def test_only_replicate_removes_backgrounds() -> None:
    assert supports_background_removal("replicate") is True
    assert supports_background_removal("cloudflare") is False
    assert supports_background_removal("openai-compatible") is False


def test_each_provider_has_a_default_model() -> None:
    for provider in IMAGE_PROVIDERS:
        assert default_model_for(provider)


def test_built_in_models_have_a_declared_input_shape() -> None:
    # The two Replicate models genuinely differ, which is exactly why an
    # arbitrary model cannot be assumed compatible.
    z_image = find_model("replicate", Z_IMAGE_TURBO_MODEL_PATH)
    flux = find_model("replicate", FLUX_2_KLEIN_MODEL_PATH)
    assert z_image is not None and flux is not None
    assert z_image.input_shape != flux.input_shape


def test_request_bodies_match_each_models_real_schema() -> None:
    z_image = replicate_input_for(Z_IMAGE_TURBO_MODEL_PATH, "a logo")
    flux = replicate_input_for(FLUX_2_KLEIN_MODEL_PATH, "a logo")
    assert z_image["num_inference_steps"] == 8
    assert "aspect_ratio" not in z_image
    assert flux["aspect_ratio"] == "1:1"
    assert "num_inference_steps" not in flux
    # A custom model only ever receives the one input its schema was checked
    # for.
    assert replicate_input_for("someone/their-model", "a logo") == {"prompt": "a logo"}


# --------------------------------------------------------------------------- #
# Settings parsing
# --------------------------------------------------------------------------- #


def test_a_request_with_no_image_block_behaves_exactly_as_before() -> None:
    settings = parse_image_settings({"replicateApiKey": "r8_key"})
    assert settings.provider == "replicate"
    assert settings.model_id == Z_IMAGE_TURBO_MODEL_PATH
    assert settings.generation_enabled is True
    assert settings.background_removal_enabled is True
    assert settings.editing_enabled is True


def test_disabling_image_generation_is_respected() -> None:
    settings = parse_image_settings(
        {"replicateApiKey": "r8_key", "isImageGenerationEnabled": False}
    )
    assert settings.generation_enabled is False


def test_replicate_without_a_key_is_not_enabled() -> None:
    settings = parse_image_settings({"imageGeneration": {"provider": "replicate"}})
    assert settings.has_generation_credential is False
    assert settings.generation_enabled is False


def test_cloudflare_needs_both_halves_of_its_credential() -> None:
    settings = parse_image_settings(
        {
            "imageGeneration": {
                "provider": "cloudflare",
                "cloudflareAccountId": "a" * 32,
                "cloudflareApiToken": "cf-token",
            }
        }
    )
    assert settings.provider == "cloudflare"
    assert settings.model_id == CLOUDFLARE_FLUX_SCHNELL_MODEL
    assert settings.has_generation_credential is True
    assert settings.cloudflare_endpoint.endswith(
        f"/accounts/{'a' * 32}/ai/run/{CLOUDFLARE_FLUX_SCHNELL_MODEL}"
    )


def test_cloudflare_rejects_a_malformed_account_id() -> None:
    with pytest.raises(ImageConfigError) as raised:
        parse_image_settings(
            {
                "imageGeneration": {
                    "provider": "cloudflare",
                    "cloudflareAccountId": "not-an-account",
                    "cloudflareApiToken": "cf-token",
                }
            }
        )
    assert "hexadecimal" in str(raised.value)


def test_cloudflare_half_a_credential_is_reported_not_ignored() -> None:
    with pytest.raises(ImageConfigError) as raised:
        parse_image_settings(
            {
                "imageGeneration": {
                    "provider": "cloudflare",
                    "cloudflareAccountId": "a" * 32,
                }
            }
        )
    assert "API token" in str(raised.value)


def test_cloudflare_model_id_must_be_a_workers_ai_id() -> None:
    with pytest.raises(ImageConfigError):
        parse_image_settings(
            {
                "imageGeneration": {
                    "provider": "cloudflare",
                    "model": "black-forest-labs/flux",
                    "cloudflareAccountId": "a" * 32,
                    "cloudflareApiToken": "cf-token",
                }
            }
        )


def test_choosing_cloudflare_leaves_replicate_untouched() -> None:
    settings = parse_image_settings(
        {
            "replicateApiKey": "r8_key",
            "imageGeneration": {
                "provider": "cloudflare",
                "cloudflareAccountId": "a" * 32,
                "cloudflareApiToken": "cf-token",
            },
        }
    )
    assert settings.provider == "cloudflare"
    # Replicate's key is still there, and still does background removal.
    assert settings.replicate_api_key == "r8_key"
    assert settings.background_removal_enabled is True


def test_openai_compatible_localhost_may_omit_a_key() -> None:
    settings = parse_image_settings(
        {
            "imageGeneration": {
                "provider": "openai-compatible",
                "openAiImageBaseUrl": "http://localhost:8000/v1",
                "model": "sd-xl",
            }
        }
    )
    assert settings.has_generation_credential is True
    assert settings.openai_image_model == "sd-xl"


def test_openai_compatible_remote_endpoint_requires_a_key() -> None:
    with pytest.raises(ImageConfigError) as raised:
        parse_image_settings(
            {
                "imageGeneration": {
                    "provider": "openai-compatible",
                    "openAiImageBaseUrl": "https://images.example.com/v1",
                }
            }
        )
    assert "own API key" in str(raised.value)


def test_openai_compatible_rejects_plaintext_http_off_the_machine() -> None:
    with pytest.raises(ImageConfigError) as raised:
        parse_image_settings(
            {
                "imageGeneration": {
                    "provider": "openai-compatible",
                    "openAiImageBaseUrl": "http://images.example.com/v1",
                    "openAiImageApiKey": "sk-x",
                }
            }
        )
    assert "https" in str(raised.value)


@pytest.mark.parametrize(
    "url",
    [
        "ftp://images.example.com/v1",
        "https://user:pass@images.example.com/v1",
        "https:///v1",
        "not a url",
    ],
)
def test_openai_compatible_refuses_unsafe_endpoints(url: str) -> None:
    with pytest.raises(ImageConfigError):
        parse_image_settings(
            {
                "imageGeneration": {
                    "provider": "openai-compatible",
                    "openAiImageBaseUrl": url,
                    "openAiImageApiKey": "sk-x",
                }
            }
        )


def test_openai_compatible_without_a_base_url_is_refused() -> None:
    with pytest.raises(ImageConfigError) as raised:
        parse_image_settings({"imageGeneration": {"provider": "openai-compatible"}})
    assert "base URL" in str(raised.value)


def test_unknown_provider_names_the_supported_ones() -> None:
    with pytest.raises(ImageConfigError) as raised:
        parse_image_settings({"imageGeneration": {"provider": "midjourney"}})
    assert "replicate" in str(raised.value)


def test_a_custom_replicate_model_is_carried_but_marked_custom() -> None:
    settings = parse_image_settings(
        {
            "replicateApiKey": "r8_key",
            "imageGeneration": {
                "provider": "replicate",
                "model": "someone/their-model",
            },
        }
    )
    assert settings.model_id == "someone/their-model"
    assert settings.custom_replicate_model == "someone/their-model"


def test_a_built_in_replicate_model_is_not_marked_custom() -> None:
    settings = parse_image_settings(
        {
            "replicateApiKey": "r8_key",
            "imageGeneration": {
                "provider": "replicate",
                "model": FLUX_2_KLEIN_MODEL_PATH,
            },
        }
    )
    assert settings.custom_replicate_model is None


def test_replicate_model_id_shape_is_enforced() -> None:
    with pytest.raises(ImageConfigError):
        parse_image_settings(
            {
                "replicateApiKey": "r8_key",
                "imageGeneration": {"provider": "replicate", "model": "no-slash"},
            }
        )


def test_settings_describe_never_returns_a_credential() -> None:
    settings = ImageGenerationSettings(
        provider="cloudflare",
        cloudflare_account_id="a" * 32,
        cloudflare_api_token="cf-token",
        replicate_api_key="r8_key",
        openai_image_api_key="sk-x",
    )
    described = settings.describe()
    serialized = repr(described)
    assert "cf-token" not in serialized
    assert "r8_key" not in serialized
    assert "sk-x" not in serialized
    assert described["provider"] == "cloudflare"


# --------------------------------------------------------------------------- #
# Custom Replicate model schema validation
# --------------------------------------------------------------------------- #


def _schema(
    input_properties: dict[str, Any],
    output: dict[str, Any] | None,
    required: list[str] | None = None,
) -> dict[str, Any]:
    schemas: dict[str, Any] = {
        "Input": {"properties": input_properties, **({"required": required} if required else {})}
    }
    if output is not None:
        schemas["Output"] = output
    return {
        "latest_version": {"openapi_schema": {"components": {"schemas": schemas}}}
    }


def test_a_text_to_image_model_passes() -> None:
    result = replicate.check_model_schema(
        "someone/their-model",
        _schema(
            {"prompt": {"type": "string"}},
            {"type": "array", "items": {"type": "string", "format": "uri"}},
        ),
    )
    assert result.ok is True
    assert "text prompt" in result.message


def test_a_single_uri_output_passes() -> None:
    result = replicate.check_model_schema(
        "someone/their-model",
        _schema({"prompt": {"type": "string"}}, {"type": "string", "format": "uri"}),
    )
    assert result.ok is True


def test_a_model_without_a_prompt_input_is_refused() -> None:
    result = replicate.check_model_schema(
        "someone/upscaler",
        _schema({"image": {"type": "string", "format": "uri"}}, {"type": "string", "format": "uri"}),
    )
    assert result.ok is False
    assert "'prompt'" in result.message


def test_a_model_that_returns_text_is_refused() -> None:
    result = replicate.check_model_schema(
        "someone/captioner",
        _schema({"prompt": {"type": "string"}}, {"type": "string"}),
    )
    assert result.ok is False
    assert "image output" in result.message


def test_a_model_with_no_output_schema_is_refused_not_assumed() -> None:
    result = replicate.check_model_schema(
        "someone/mystery", _schema({"prompt": {"type": "string"}}, None)
    )
    assert result.ok is False


def test_a_model_with_extra_required_inputs_is_refused() -> None:
    result = replicate.check_model_schema(
        "someone/needs-more",
        _schema(
            {"prompt": {"type": "string"}, "mask": {"type": "string"}},
            {"type": "string", "format": "uri"},
            required=["prompt", "mask"],
        ),
    )
    assert result.ok is False
    assert "mask" in result.message


def test_a_model_with_no_published_version_is_refused() -> None:
    result = replicate.check_model_schema("someone/unpublished", {})
    assert result.ok is False
    assert "no published version" in result.message


def test_a_non_string_prompt_is_refused() -> None:
    result = replicate.check_model_schema(
        "someone/odd",
        _schema(
            {"prompt": {"type": "array"}}, {"type": "string", "format": "uri"}
        ),
    )
    assert result.ok is False


@pytest.mark.asyncio
async def test_validate_model_schema_reads_the_models_own_schema() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(
            200,
            json=_schema(
                {"prompt": {"type": "string"}},
                {"type": "array", "items": {"type": "string", "format": "uri"}},
            ),
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await replicate.validate_model_schema(
            "someone/their-model", "r8_key", client=client
        )

    assert seen["url"] == "https://api.replicate.com/v1/models/someone/their-model"
    assert seen["auth"] == "Bearer r8_key"
    assert result.ok is True


@pytest.mark.asyncio
async def test_validate_model_schema_reports_a_missing_model() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "Not found"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(Exception) as raised:
            await replicate.validate_model_schema(
                "someone/missing", "r8_key", client=client
            )
    assert getattr(raised.value, "category", None) == "model"
