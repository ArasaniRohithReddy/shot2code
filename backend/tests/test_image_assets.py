"""The adapter that turns any provider response into a safe, embeddable image.

The point of these tests is that nothing success-shaped ever comes back for a
payload that has no image in it, and that nothing unfetchable or unsafe is
passed on as a URL.
"""

import base64
from pathlib import Path
from typing import Any

import pytest

from image_generation.assets import (
    NormalizedImage,
    normalize_image_result,
    persist_image_bytes,
    resolve_image_bytes,
)
from image_generation.errors import ImageProviderFailure

PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
PNG_BASE64 = base64.b64encode(PNG_BYTES).decode("ascii")
JPEG_BYTES = b"\xff\xd8\xff" + b"\x00" * 200


@pytest.fixture
def asset_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.setattr("uploaded_assets.store.LOCAL_ASSET_DIR", str(tmp_path))
    monkeypatch.setattr("asset_urls.LOCAL_ASSET_DIR", str(tmp_path))
    return tmp_path


@pytest.mark.asyncio
async def test_public_url_passes_through_unchanged() -> None:
    image = await normalize_image_result(
        "https://replicate.delivery/abc/out.png",
        asset_base_url="http://127.0.0.1:7001",
        provider="replicate",
    )
    assert image.url == "https://replicate.delivery/abc/out.png"
    assert image.data is None
    assert image.is_local is False


@pytest.mark.asyncio
async def test_replicate_list_and_dict_shapes_are_understood() -> None:
    for payload in (
        ["https://replicate.delivery/a.png"],
        {"url": "https://replicate.delivery/a.png"},
        [{"url": "https://replicate.delivery/a.png"}],
        {"output": ["https://replicate.delivery/a.png"]},
    ):
        image = await normalize_image_result(
            payload, asset_base_url="http://127.0.0.1:7001", provider="replicate"
        )
        assert image.url == "https://replicate.delivery/a.png"


@pytest.mark.asyncio
async def test_cloudflare_base64_envelope_becomes_a_local_asset(
    asset_dir: Path,
) -> None:
    payload: dict[str, Any] = {
        "result": {"image": base64.b64encode(JPEG_BYTES).decode("ascii")},
        "success": True,
    }
    image = await normalize_image_result(
        payload, asset_base_url="http://127.0.0.1:7001", provider="cloudflare"
    )

    assert image.url.startswith("http://127.0.0.1:7001/local-assets/")
    assert image.mime_type == "image/jpeg"
    # Bytes travel with the result because a local URL is not model-reachable.
    assert image.data == JPEG_BYTES
    assert list(asset_dir.glob("asset_*.jpg"))


@pytest.mark.asyncio
async def test_openai_b64_json_becomes_a_local_asset(asset_dir: Path) -> None:
    payload = {"data": [{"b64_json": PNG_BASE64}]}
    image = await normalize_image_result(
        payload,
        asset_base_url="http://127.0.0.1:7001",
        provider="openai-compatible",
    )
    assert image.url.startswith("http://127.0.0.1:7001/local-assets/")
    assert image.data == PNG_BYTES


@pytest.mark.asyncio
async def test_raw_bytes_become_a_local_asset(asset_dir: Path) -> None:
    image = await normalize_image_result(
        PNG_BYTES, asset_base_url="http://127.0.0.1:7001", provider="cloudflare"
    )
    assert image.url.startswith("http://127.0.0.1:7001/local-assets/")
    assert image.mime_type == "image/png"


@pytest.mark.asyncio
async def test_data_url_becomes_a_local_asset(asset_dir: Path) -> None:
    image = await normalize_image_result(
        f"data:image/png;base64,{PNG_BASE64}",
        asset_base_url="http://127.0.0.1:7001",
        provider="openai-compatible",
    )
    assert image.url.startswith("http://127.0.0.1:7001/local-assets/")
    assert image.data == PNG_BYTES


@pytest.mark.asyncio
async def test_identical_bytes_dedupe_to_one_asset(asset_dir: Path) -> None:
    first = await persist_image_bytes(
        PNG_BYTES, asset_base_url="http://127.0.0.1:7001", provider="cloudflare"
    )
    second = await persist_image_bytes(
        PNG_BYTES, asset_base_url="http://127.0.0.1:7001", provider="cloudflare"
    )
    assert first.url == second.url
    assert len(list(asset_dir.glob("asset_*"))) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {},
        [],
        "",
        {"status": "succeeded"},
        {"data": [{"revised_prompt": "a cat"}]},
        None,
        42,
    ],
)
async def test_payloads_with_no_image_raise_rather_than_return_empty(
    payload: Any,
) -> None:
    with pytest.raises(ImageProviderFailure) as raised:
        await normalize_image_result(
            payload, asset_base_url="http://127.0.0.1:7001", provider="replicate"
        )
    assert raised.value.category == "unknown"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/image.png",
        "http://localhost:9999/image.png",
    ],
)
async def test_unsafe_urls_are_refused(url: str) -> None:
    with pytest.raises(ImageProviderFailure):
        await normalize_image_result(
            url, asset_base_url="http://127.0.0.1:7001", provider="openai-compatible"
        )


@pytest.mark.asyncio
async def test_refused_url_message_does_not_echo_the_path() -> None:
    with pytest.raises(ImageProviderFailure) as raised:
        await normalize_image_result(
            "http://10.0.0.5/secret/token-abcdefgh/image.png",
            asset_base_url="http://127.0.0.1:7001",
            provider="openai-compatible",
        )
    assert "secret" not in raised.value.message
    assert "token-abcdefgh" not in raised.value.message


@pytest.mark.asyncio
async def test_our_own_served_asset_url_is_accepted_with_bytes(
    asset_dir: Path,
) -> None:
    (asset_dir / "asset_known.png").write_bytes(PNG_BYTES)
    image = await normalize_image_result(
        "http://127.0.0.1:7001/local-assets/asset_known.png",
        asset_base_url="http://127.0.0.1:7001",
        provider="replicate",
    )
    assert image.data == PNG_BYTES
    assert image.is_local is True


@pytest.mark.asyncio
async def test_oversized_image_is_refused(
    monkeypatch: pytest.MonkeyPatch, asset_dir: Path
) -> None:
    monkeypatch.setattr("image_generation.assets.MAX_UPLOADED_ASSET_BYTES", 16)
    with pytest.raises(ImageProviderFailure) as raised:
        await persist_image_bytes(
            PNG_BYTES * 10, asset_base_url="http://127.0.0.1:7001", provider="cloudflare"
        )
    assert raised.value.category == "configuration"


@pytest.mark.asyncio
async def test_resolve_image_bytes_reads_a_local_asset(asset_dir: Path) -> None:
    (asset_dir / "asset_in.png").write_bytes(PNG_BYTES)
    data, mime = await resolve_image_bytes(
        "http://127.0.0.1:7001/local-assets/asset_in.png"
    )
    assert data == PNG_BYTES
    assert mime == "image/png"


@pytest.mark.asyncio
async def test_resolve_image_bytes_refuses_private_hosts() -> None:
    with pytest.raises(ImageProviderFailure):
        await resolve_image_bytes("http://192.168.1.10/image.png")


def test_normalized_image_reports_locality() -> None:
    assert NormalizedImage(url="https://x/y.png", mime_type="image/png").is_local is False
    assert (
        NormalizedImage(url="http://127.0.0.1/x.png", mime_type="image/png", data=b"x")
        .is_local
        is True
    )
