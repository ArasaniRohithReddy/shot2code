"""The image-model catalog endpoints.

The catalog is a pure read with no credentials in it, and the validation
endpoint is the only door through which a Replicate model this build has never
seen becomes usable.
"""

from typing import Any

import pytest

from routes.image_models import (
    ImageModelValidationBody,
    get_image_models,
    post_image_model_validate,
)


@pytest.mark.asyncio
async def test_catalog_lists_every_provider_and_model() -> None:
    catalog = await get_image_models()

    provider_ids = {provider.id for provider in catalog.providers}
    assert provider_ids == {"replicate", "cloudflare", "openai-compatible"}

    replicate_models = {
        model.id for model in catalog.models if model.provider == "replicate"
    }
    assert replicate_models == {
        "prunaai/z-image-turbo",
        "black-forest-labs/flux-2-klein-4b",
    }


@pytest.mark.asyncio
async def test_catalog_marks_background_removal_as_replicate_only() -> None:
    catalog = await get_image_models()
    by_id = {provider.id: provider for provider in catalog.providers}
    assert by_id["replicate"].supportsBackgroundRemoval is True
    assert by_id["cloudflare"].supportsBackgroundRemoval is False
    assert by_id["openai-compatible"].supportsBackgroundRemoval is False


@pytest.mark.asyncio
async def test_only_replicate_accepts_a_custom_model() -> None:
    catalog = await get_image_models()
    custom = {
        provider.id: provider.supportsCustomModels for provider in catalog.providers
    }
    assert custom == {
        "replicate": True,
        "cloudflare": False,
        "openai-compatible": False,
    }


@pytest.mark.asyncio
async def test_catalog_carries_attributed_and_dated_cost_wording() -> None:
    catalog = await get_image_models()
    for model in catalog.models:
        assert model.costNote
        # A figure is allowed, but only with its source date and a hedge.
        if "$" in model.costNote:
            lowered = model.costNote.lower()
            assert "checked" in lowered, model.id
            assert "can change" in lowered, model.id
        for phrase in ("free forever", "always free", "unlimited"):
            assert phrase not in model.costNote.lower(), model.id
    assert "can change" in catalog.cloudflareAllocationNote
    # The corrected Cloudflare terms, verified against their pricing page.
    assert (
        "both the Workers Free and Workers Paid plans"
        in catalog.cloudflareAllocationNote
    )
    assert "00:00 UTC" in catalog.cloudflareAllocationNote
    assert "on the Workers Free plan" not in catalog.cloudflareAllocationNote


@pytest.mark.asyncio
async def test_validation_refuses_non_replicate_providers() -> None:
    result = await post_image_model_validate(
        ImageModelValidationBody(provider="cloudflare", model="@cf/x", apiKey="k")
    )
    assert result.ok is False
    assert result.category == "configuration"


@pytest.mark.asyncio
async def test_validation_needs_a_replicate_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("routes.image_models.REPLICATE_API_KEY", None)
    result = await post_image_model_validate(
        ImageModelValidationBody(provider="replicate", model="someone/model")
    )
    assert result.ok is False
    assert result.category == "credentials"


@pytest.mark.asyncio
async def test_validation_passes_a_compatible_model_through(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Result:
        ok = True
        message = "This model takes a text prompt and returns an image."
        model = "someone/model"

    async def fake_validate(model_path: str, api_token: str, **kwargs: Any) -> _Result:
        assert api_token == "r8_from_request"
        return _Result()

    monkeypatch.setattr("routes.image_models.validate_model_schema", fake_validate)

    result = await post_image_model_validate(
        ImageModelValidationBody(
            provider="replicate", model="someone/model", apiKey="r8_from_request"
        )
    )
    assert result.ok is True
    assert result.category == "ready"


@pytest.mark.asyncio
async def test_validation_reports_an_incompatible_model_as_a_model_problem(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Result:
        ok = False
        message = "This model has no 'prompt' input."
        model = "someone/upscaler"

    async def fake_validate(model_path: str, api_token: str, **kwargs: Any) -> _Result:
        return _Result()

    monkeypatch.setattr("routes.image_models.validate_model_schema", fake_validate)

    result = await post_image_model_validate(
        ImageModelValidationBody(
            provider="replicate", model="someone/upscaler", apiKey="r8_key"
        )
    )
    assert result.ok is False
    assert result.category == "model"
    assert "prompt" in result.message


@pytest.mark.asyncio
async def test_validation_never_echoes_the_key_it_was_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from image_generation.errors import failure_from_status

    async def fake_validate(model_path: str, api_token: str, **kwargs: Any) -> Any:
        raise failure_from_status(
            401,
            "replicate",
            detail="Invalid token r8_supersecretvalue",
            secrets=("r8_supersecretvalue",),
        )

    monkeypatch.setattr("routes.image_models.validate_model_schema", fake_validate)

    result = await post_image_model_validate(
        ImageModelValidationBody(
            provider="replicate",
            model="someone/model",
            apiKey="r8_supersecretvalue",
        )
    )
    assert result.ok is False
    assert result.category == "credentials"
    assert "r8_supersecretvalue" not in result.message
