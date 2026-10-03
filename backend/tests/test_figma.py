import base64
from typing import cast

import httpx
import pytest

from routes.figma import (
    FigmaRateLimitError,
    import_figma_design,
    import_figma_frames,
    parse_figma_url,
)


def test_parse_figma_url_extracts_file_and_node() -> None:
    assert parse_figma_url(
        "https://www.figma.com/design/abc123/Product?node-id=10-22"
    ) == ("abc123", "10:22")


@pytest.mark.asyncio
async def test_import_figma_frames_renders_the_requested_node(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    async def fake_get(
        _self: httpx.AsyncClient,
        url: str,
        **_kwargs: object,
    ) -> httpx.Response:
        calls.append(url)
        request = httpx.Request("GET", url)
        if "/images/" in url:
            return httpx.Response(
                200,
                json={"images": {"10:22": "https://cdn.example/frame.png"}},
                request=request,
            )
        return httpx.Response(
            200,
            content=b"png-bytes",
            headers={"content-type": "image/png"},
            request=request,
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    images = await import_figma_frames(
        "https://www.figma.com/design/abc123/Product?node-id=10-22",
        "figma-token",
    )

    assert calls[0].endswith("/images/abc123")
    assert images == [
        "data:image/png;base64,"
        + base64.b64encode(b"png-bytes").decode("ascii")
    ]


@pytest.mark.asyncio
async def test_import_figma_frames_preserves_actionable_rate_limit_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_get(
        _self: httpx.AsyncClient,
        url: str,
        **_kwargs: object,
    ) -> httpx.Response:
        return httpx.Response(
            429,
            headers={
                "Retry-After": "60",
                "X-Figma-Plan-Tier": "starter",
                "X-Figma-Rate-Limit-Type": "low",
                "X-Figma-Upgrade-Link": "https://www.figma.com/pricing/",
            },
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    with pytest.raises(FigmaRateLimitError) as caught:
        await import_figma_frames(
            "https://www.figma.com/design/abc123/Product",
            "figma-token",
        )

    message = str(caught.value)
    assert "Retry after 60 seconds" in message
    assert "Plan: starter" in message
    assert "Limit type: low" in message
    assert "https://www.figma.com/pricing/" in message


@pytest.mark.asyncio
async def test_import_figma_design_keeps_image_fills_and_exported_nodes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_get(
        _self: httpx.AsyncClient,
        url: str,
        **kwargs: object,
    ) -> httpx.Response:
        request = httpx.Request("GET", url)
        params = kwargs.get("params")
        typed_params = (
            cast(dict[str, object], params) if isinstance(params, dict) else {}
        )
        if url.endswith("/files/abc123/nodes"):
            return httpx.Response(
                200,
                json={
                    "nodes": {
                        "10:22": {
                            "document": {
                                "id": "10:22",
                                "name": "Hero",
                                "type": "FRAME",
                                "children": [
                                    {
                                        "id": "20:20",
                                        "name": "Photo",
                                        "type": "RECTANGLE",
                                        "fills": [
                                            {
                                                "type": "IMAGE",
                                                "imageRef": "image-ref-1",
                                            }
                                        ],
                                    },
                                    {
                                        "id": "20:30",
                                        "name": "Logo",
                                        "type": "VECTOR",
                                        "exportSettings": [{"format": "SVG"}],
                                    },
                                ],
                            }
                        }
                    }
                },
                request=request,
            )
        if url.endswith("/files/abc123/images"):
            return httpx.Response(
                200,
                json={
                    "error": False,
                    "meta": {
                        "images": {
                            "image-ref-1": "https://cdn.example/photo.png"
                        }
                    },
                },
                request=request,
            )
        if url.endswith("/images/abc123"):
            ids = typed_params.get("ids")
            image_url = (
                "https://cdn.example/logo.png"
                if ids == "20:30"
                else "https://cdn.example/frame.png"
            )
            return httpx.Response(
                200,
                json={"images": {str(ids): image_url}},
                request=request,
            )
        return httpx.Response(
            200,
            content=b"\x89PNG\r\n\x1a\nimage",
            headers={"content-type": "image/png"},
            request=request,
        )

    downloaded = 0

    async def fake_download(
        _client: httpx.AsyncClient,
        _url: str,
        *,
        asset_base_url: str,
        remaining_bytes: int,
    ) -> tuple[str, str, int]:
        nonlocal downloaded
        assert remaining_bytes > 0
        downloaded += 1
        return (
            f"{asset_base_url}/local-assets/asset-{downloaded}.png",
            "image/png",
            100,
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr("routes.figma._download_figma_asset", fake_download)

    result = await import_figma_design(
        "https://www.figma.com/design/abc123/Product?node-id=10-22",
        "figma-token",
        "http://127.0.0.1:7001",
    )

    assert len(result["images"]) == 1
    assert [asset["kind"] for asset in result["sourceAssets"]] == [
        "image fill",
        "exported node",
    ]
    assert [asset["name"] for asset in result["sourceAssets"]] == [
        "photo",
        "logo",
    ]
    assert result["warnings"] == []
