import base64

import pytest
from starlette.requests import Request

from routes.design_assets import (
    DesignAssetInput,
    PersistDesignAssetsRequest,
    persist_design_assets,
)


def local_request() -> Request:
    return Request(
        {
            "type": "http",
            "scheme": "http",
            "server": ("127.0.0.1", 7001),
            "path": "/api/design-assets/persist",
            "root_path": "",
            "headers": [],
        }
    )


@pytest.mark.asyncio
async def test_persists_stitch_images_as_reusable_local_assets(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("uploaded_assets.store.LOCAL_ASSET_DIR", str(tmp_path))
    png = b"\x89PNG\r\n\x1a\nasset"
    result = await persist_design_assets(
        PersistDesignAssetsRequest(
            assets=[
                DesignAssetInput(
                    name="hero.png",
                    content_base64=base64.b64encode(png).decode("ascii"),
                    mime_type="image/png",
                    source="stitch",
                    kind="image",
                )
            ]
        ),
        local_request(),
    )

    assets = result["sourceAssets"]
    assert isinstance(assets, list)
    assert assets == [
        {
            "name": "hero.png",
            "url": (
                "http://127.0.0.1:7001/local-assets/"
                "asset_789a58134ce1a6fcc976dbde.png"
            ),
            "mimeType": "image/png",
            "source": "stitch",
            "kind": "image",
        }
    ]
    assert list(tmp_path.glob("asset_*.png"))


@pytest.mark.asyncio
async def test_skips_non_image_design_files() -> None:
    result = await persist_design_assets(
        PersistDesignAssetsRequest(
            assets=[
                DesignAssetInput(
                    name="theme.css",
                    content_base64=base64.b64encode(b"body{}").decode("ascii"),
                    mime_type="text/css",
                    source="stitch",
                    kind="stylesheet",
                )
            ]
        ),
        local_request(),
    )

    assert result["sourceAssets"] == []
    assert "not a supported reusable image type" in str(result["warnings"])
