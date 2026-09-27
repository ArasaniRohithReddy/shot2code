import base64

import httpx
import pytest

from routes.figma import import_figma_frames, parse_figma_url


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
