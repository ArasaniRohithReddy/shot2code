"""Failure semantics: what a user is told when image generation goes wrong.

The regression these cover is the old behaviour where every per-prompt failure
became ``None``, the tool still reported success, and the UI showed blank tiles
under a green "Generated 3 images".
"""

import base64
from typing import Any

import httpx
import pytest

from agent.state import AgentFileState
from agent.tools.runtime import AgentToolRuntime
from agent.tools.types import ToolCall
from image_generation import cloudflare, openai_compatible
from image_generation.assets import NormalizedImage
from image_generation.errors import (
    ImageProviderFailure,
    failure_from_exception,
    failure_from_status,
    image_failure,
)
from image_generation.generation import (
    BatchImageResult,
    ImageResult,
    generate_images,
)
from image_generation.settings import ImageGenerationSettings

PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _image(url: str = "https://replicate.delivery/a.png") -> NormalizedImage:
    return NormalizedImage(url=url, mime_type="image/png")


# --------------------------------------------------------------------------- #
# Classification
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("status", "category"),
    [
        (429, "quota"),
        (402, "billing"),
        (401, "credentials"),
        (403, "permissions"),
        (404, "model"),
        (408, "network"),
        (422, "configuration"),
        (500, "network"),
        (503, "network"),
    ],
)
def test_http_status_maps_to_the_category_a_user_can_act_on(
    status: int, category: str
) -> None:
    failure = failure_from_status(status, "replicate", detail="body")
    assert failure.category == category
    assert failure.action
    assert failure.status_code == status


def test_rate_limit_stays_a_rate_limit_even_when_the_body_says_quota() -> None:
    failure = failure_from_status(
        429, "cloudflare", detail="Account quota exceeded for this model"
    )
    assert failure.category == "quota"


def test_payment_required_stays_billing_even_when_the_body_says_limit() -> None:
    failure = failure_from_status(402, "replicate", detail="monthly limit reached")
    assert failure.category == "billing"


def test_timeout_is_classified_as_network() -> None:
    failure = failure_from_exception(TimeoutError("timed out"), "replicate")
    assert failure.category == "network"
    assert failure.is_retryable is True


def test_generic_provider_error_is_still_actionable() -> None:
    failure = failure_from_exception(RuntimeError("something odd"), "replicate")
    assert failure.category == "unknown"
    assert failure.message
    assert failure.action


def test_failures_never_echo_a_credential() -> None:
    failure = failure_from_status(
        401,
        "replicate",
        detail="Invalid token r8_abcdefghijklmnop for account",
        secrets=("r8_abcdefghijklmnop",),
    )
    assert "r8_abcdefghijklmnop" not in failure.message
    assert "r8_abcdefghijklmnop" not in failure.detail


def test_failure_serializes_with_guidance() -> None:
    payload = image_failure("quota", "cloudflare", detail="slow down").to_dict()
    assert payload["category"] == "quota"
    assert payload["retryable"] is True
    action = str(payload["action"])
    assert "Settings" in action or "reset" in action


def test_billing_and_credential_failures_are_not_retryable() -> None:
    assert image_failure("billing", "replicate").is_retryable is False
    assert image_failure("credentials", "replicate").is_retryable is False


# --------------------------------------------------------------------------- #
# Batch results
# --------------------------------------------------------------------------- #


def test_batch_counts_successes_only() -> None:
    batch = BatchImageResult(
        (
            ImageResult(prompt="a", image=_image()),
            ImageResult(prompt="b", failure=image_failure("quota", "replicate")),
            ImageResult(prompt="c", failure=image_failure("quota", "replicate")),
        )
    )
    assert batch.success_count == 1
    assert batch.requested_count == 3
    assert batch.partial is True
    assert batch.all_failed is False
    assert batch.summary_message() == "Generated 1 of 3 images."


def test_batch_with_no_images_says_so() -> None:
    batch = BatchImageResult(
        (ImageResult(prompt="a", failure=image_failure("billing", "replicate")),)
    )
    assert batch.all_failed is True
    assert batch.summary_message() == "Generated 0 of 1 image."


def test_full_batch_keeps_the_plain_wording() -> None:
    batch = BatchImageResult(
        (
            ImageResult(prompt="a", image=_image()),
            ImageResult(prompt="b", image=_image()),
        )
    )
    assert batch.summary_message() == "Generated 2 images."


def test_failed_result_serializes_its_reason_not_an_empty_url() -> None:
    failure = image_failure("quota", "replicate", detail="slow down")
    payload = ImageResult(prompt="a", failure=failure).to_dict()
    assert payload["status"] == "error"
    assert payload["url"] is None
    assert payload["errorCategory"] == "quota"
    assert payload["action"]
    assert payload["error"] == failure.message


@pytest.mark.asyncio
async def test_generate_images_keeps_each_prompts_own_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_generate_one(
        prompt: str, settings: Any, asset_base_url: str
    ) -> NormalizedImage:
        if prompt == "rate limited":
            raise failure_from_status(429, "replicate")
        if prompt == "broke":
            raise failure_from_status(402, "replicate")
        return _image(f"https://replicate.delivery/{prompt}.png")

    monkeypatch.setattr(
        "image_generation.generation.generate_one", fake_generate_one
    )
    batch = await generate_images(
        ["fine", "rate limited", "broke"],
        ImageGenerationSettings(replicate_api_key="r8_key"),
    )

    assert batch.success_count == 1
    categories = [
        result.failure.category for result in batch.failed if result.failure
    ]
    assert categories == ["quota", "billing"]
    assert batch.summary_message() == "Generated 1 of 3 images."


# --------------------------------------------------------------------------- #
# The tool
# --------------------------------------------------------------------------- #


def _runtime(**kwargs: Any) -> AgentToolRuntime:
    return AgentToolRuntime(
        file_state=AgentFileState(),
        should_generate_images=True,
        openai_api_key=None,
        openai_base_url=None,
        **kwargs,
    )


@pytest.mark.asyncio
async def test_generate_images_reports_failure_when_every_prompt_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("agent.tools.runtime.REPLICATE_API_KEY", "r8_key")

    async def always_rate_limited(
        prompt: str, settings: Any, asset_base_url: str
    ) -> NormalizedImage:
        raise failure_from_status(429, "replicate")

    monkeypatch.setattr(
        "image_generation.generation.generate_one", always_rate_limited
    )

    result = await _runtime().execute(
        ToolCall(
            id="t",
            name="generate_images",
            arguments={"prompts": ["a", "b"]},
        )
    )

    assert result.ok is False
    assert result.result["generated"] == 0
    assert result.result["message"] == "Generated 0 of 2 images."
    assert result.result["errorCategory"] == "quota"
    assert result.multimodal_parts is None
    # No success-shaped empty URLs.
    assert all(item["url"] is None for item in result.result["images"])
    assert all(item["status"] == "error" for item in result.result["images"])


@pytest.mark.asyncio
async def test_generate_images_reports_a_partial_batch_truthfully(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("agent.tools.runtime.REPLICATE_API_KEY", "r8_key")

    async def half_failing(
        prompt: str, settings: Any, asset_base_url: str
    ) -> NormalizedImage:
        if prompt == "b":
            raise failure_from_status(500, "replicate")
        return _image(f"https://replicate.delivery/{prompt}.png")

    monkeypatch.setattr("image_generation.generation.generate_one", half_failing)

    result = await _runtime().execute(
        ToolCall(
            id="t", name="generate_images", arguments={"prompts": ["a", "b", "c"]}
        )
    )

    assert result.ok is True
    assert result.result["generated"] == 2
    assert result.result["requested"] == 3
    assert result.result["message"] == "Generated 2 of 3 images."
    assert len(result.multimodal_parts or []) == 2
    failed = [item for item in result.result["images"] if item["status"] == "error"]
    assert failed[0]["errorCategory"] == "network"
    assert failed[0]["action"]


@pytest.mark.asyncio
async def test_generated_local_asset_is_handed_to_the_model_as_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("agent.tools.runtime.REPLICATE_API_KEY", "r8_key")

    async def local_image(
        prompt: str, settings: Any, asset_base_url: str
    ) -> NormalizedImage:
        return NormalizedImage(
            url="http://127.0.0.1:7001/local-assets/asset_a.png",
            mime_type="image/png",
            data=PNG_BYTES,
        )

    monkeypatch.setattr("image_generation.generation.generate_one", local_image)

    result = await _runtime().execute(
        ToolCall(id="t", name="generate_images", arguments={"prompts": ["a"]})
    )

    assert result.ok is True
    part = (result.multimodal_parts or [])[0]
    # A localhost URL is not model-reachable, so the bytes travel instead.
    assert part.image_url is None
    assert part.data == PNG_BYTES


@pytest.mark.asyncio
async def test_background_removal_is_not_faked_for_other_providers() -> None:
    settings = ImageGenerationSettings(
        provider="cloudflare",
        cloudflare_account_id="a" * 32,
        cloudflare_api_token="token",
    )
    result = await _runtime(image_settings=settings).execute(
        ToolCall(
            id="t",
            name="remove_backgrounds",
            arguments={"image_urls": ["https://example.com/a.png"]},
        )
    )
    assert result.ok is False
    assert "Replicate" in result.result["error"]
    assert "cloudflare" in result.result["error"]


@pytest.mark.asyncio
async def test_background_removal_still_works_on_replicate_for_a_cloudflare_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_remove(image_url: str, api_token: str) -> str:
        assert api_token == "r8_key"
        return "https://replicate.delivery/no-bg.png"

    monkeypatch.setattr("agent.tools.runtime.remove_background_once", fake_remove)
    settings = ImageGenerationSettings(
        provider="cloudflare",
        cloudflare_account_id="a" * 32,
        cloudflare_api_token="token",
        replicate_api_key="r8_key",
    )
    result = await _runtime(image_settings=settings).execute(
        ToolCall(
            id="t",
            name="remove_backgrounds",
            arguments={"image_urls": ["https://example.com/a.png"]},
        )
    )
    assert result.ok is True
    assert result.result["images"][0]["result_url"] == (
        "https://replicate.delivery/no-bg.png"
    )


@pytest.mark.asyncio
async def test_remove_backgrounds_fails_the_tool_when_every_image_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("agent.tools.runtime.REPLICATE_API_KEY", "r8_key")

    async def always_fails(image_url: str, api_token: str) -> str:
        raise failure_from_status(429, "replicate")

    monkeypatch.setattr("agent.tools.runtime.remove_background_once", always_fails)

    result = await _runtime().execute(
        ToolCall(
            id="t",
            name="remove_backgrounds",
            arguments={"image_urls": ["https://example.com/a.png"]},
        )
    )
    assert result.ok is False
    assert result.result["processed"] == 0
    assert result.result["errorCategory"] == "quota"
    assert result.summary["images"][0]["errorCategory"] == "quota"


@pytest.mark.asyncio
async def test_remove_backgrounds_partial_batch_is_reported_truthfully(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("agent.tools.runtime.REPLICATE_API_KEY", "r8_key")

    async def half_fails(image_url: str, api_token: str) -> str:
        if "b.png" in image_url:
            raise failure_from_status(500, "replicate")
        return "https://replicate.delivery/no-bg.png"

    monkeypatch.setattr("agent.tools.runtime.remove_background_once", half_fails)

    result = await _runtime().execute(
        ToolCall(
            id="t",
            name="remove_backgrounds",
            arguments={
                "image_urls": [
                    "https://example.com/a.png",
                    "https://example.com/b.png",
                ]
            },
        )
    )
    assert result.ok is True
    assert result.result["message"] == "Removed background from 1 of 2 images."


# --------------------------------------------------------------------------- #
# Providers
# --------------------------------------------------------------------------- #


def _transport(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_cloudflare_sends_the_documented_request(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr("uploaded_assets.store.LOCAL_ASSET_DIR", str(tmp_path))
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = request.read().decode()
        return httpx.Response(
            200,
            json={
                "result": {"image": base64.b64encode(PNG_BYTES).decode("ascii")},
                "success": True,
                "errors": [],
            },
        )

    async with _transport(handler) as client:
        image = await cloudflare.generate_image(
            "a cyberpunk lizard",
            account_id="a" * 32,
            api_token="cf-token",
            model="@cf/black-forest-labs/flux-1-schnell",
            asset_base_url="http://127.0.0.1:7001",
            client=client,
        )

    assert seen["url"] == (
        "https://api.cloudflare.com/client/v4/accounts/"
        + "a" * 32
        + "/ai/run/@cf/black-forest-labs/flux-1-schnell"
    )
    assert seen["auth"] == "Bearer cf-token"
    assert '"prompt":"a cyberpunk lizard"' in seen["body"]
    assert '"steps":4' in seen["body"]
    assert image.url.startswith("http://127.0.0.1:7001/local-assets/")


@pytest.mark.asyncio
async def test_cloudflare_rate_limit_is_classified_and_redacted() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={"success": False, "errors": [{"message": "Rate limited: cf-token"}]},
        )

    async with _transport(handler) as client:
        with pytest.raises(ImageProviderFailure) as raised:
            await cloudflare.generate_image(
                "x",
                account_id="a" * 32,
                api_token="cf-token",
                model="@cf/black-forest-labs/flux-1-schnell",
                asset_base_url="",
                client=client,
            )

    assert raised.value.category == "quota"
    assert "cf-token" not in raised.value.message


@pytest.mark.asyncio
async def test_cloudflare_binary_response_is_supported(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr("uploaded_assets.store.LOCAL_ASSET_DIR", str(tmp_path))

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=PNG_BYTES, headers={"content-type": "image/png"}
        )

    async with _transport(handler) as client:
        image = await cloudflare.generate_image(
            "x",
            account_id="a" * 32,
            api_token="cf-token",
            model="@cf/black-forest-labs/flux-1-schnell",
            asset_base_url="http://127.0.0.1:7001",
            client=client,
        )
    assert image.data == PNG_BYTES


@pytest.mark.asyncio
async def test_cloudflare_without_credentials_fails_before_any_request() -> None:
    with pytest.raises(ImageProviderFailure) as raised:
        await cloudflare.generate_image(
            "x", account_id="", api_token="", model="@cf/x", asset_base_url=""
        )
    assert raised.value.category == "credentials"


@pytest.mark.asyncio
async def test_openai_compatible_generation_posts_to_images_generations(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr("uploaded_assets.store.LOCAL_ASSET_DIR", str(tmp_path))
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(
            200,
            json={
                "data": [{"b64_json": base64.b64encode(PNG_BYTES).decode("ascii")}]
            },
        )

    async with _transport(handler) as client:
        image = await openai_compatible.generate_image(
            "a logo",
            base_url="https://images.example.com/v1",
            api_key="sk-endpoint",
            model="gpt-image-1",
            asset_base_url="http://127.0.0.1:7001",
            client=client,
        )

    assert seen["url"] == "https://images.example.com/v1/images/generations"
    assert seen["auth"] == "Bearer sk-endpoint"
    assert image.data == PNG_BYTES


@pytest.mark.asyncio
async def test_openai_compatible_localhost_may_omit_a_key(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr("uploaded_assets.store.LOCAL_ASSET_DIR", str(tmp_path))
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(
            200, json={"data": [{"url": "https://cdn.example.com/a.png"}]}
        )

    async with _transport(handler) as client:
        image = await openai_compatible.generate_image(
            "a logo",
            base_url="http://localhost:8000/v1",
            api_key=None,
            model="sd-xl",
            asset_base_url="http://127.0.0.1:7001",
            client=client,
        )
    assert seen["auth"] is None
    assert image.url == "https://cdn.example.com/a.png"


@pytest.mark.asyncio
async def test_openai_compatible_missing_edits_route_is_a_capability_answer() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": {"message": "Not Found"}})

    async with _transport(handler) as client:
        with pytest.raises(openai_compatible.EndpointCapabilityMissing) as raised:
            await openai_compatible.edit_image(
                "make it blue",
                image=(PNG_BYTES, "image/png"),
                base_url="http://localhost:8000/v1",
                api_key=None,
                model="sd-xl",
                asset_base_url="",
                client=client,
            )
    assert "does not implement image edits" in raised.value.message


@pytest.mark.asyncio
async def test_openai_compatible_billing_error_is_classified() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            402, json={"error": {"message": "Your credit balance is too low"}}
        )

    async with _transport(handler) as client:
        with pytest.raises(ImageProviderFailure) as raised:
            await openai_compatible.generate_image(
                "a logo",
                base_url="https://images.example.com/v1",
                api_key="sk-endpoint",
                model="gpt-image-1",
                asset_base_url="",
                client=client,
            )
    assert raised.value.category == "billing"
    assert "sk-endpoint" not in raised.value.message
