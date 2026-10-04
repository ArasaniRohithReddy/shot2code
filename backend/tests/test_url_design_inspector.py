from io import BytesIO
from typing import Any

import pytest
from PIL import Image

from free_images.download import ImageDownloadRejected
from routes.url_design_inspector import (
    MAX_FULL_PAGE_HEIGHT,
    _bounded_capture_height,
    _capture_responsive_screenshot,
    validate_public_website_url,
)
from preview_screenshot.diagnostics import png_is_nearly_blank


def png(color: tuple[int, int, int], size: tuple[int, int] = (64, 64)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, color).save(output, format="PNG")
    return output.getvalue()


class FakePage:
    def __init__(self, document_height: int, image: bytes) -> None:
        self.document_height = document_height
        self.image = image
        self.viewport: dict[str, int] | None = None
        self.screenshot_calls: list[dict[str, Any]] = []
        self.scroll_positions: list[int] = []

    async def set_viewport_size(self, viewport: dict[str, int]) -> None:
        self.viewport = viewport

    async def wait_for_timeout(self, _milliseconds: int) -> None:
        return None

    async def evaluate(self, script: str, value: object = None) -> object:
        if "scrollHeight" in script:
            return self.document_height
        if "scrollTo" in script and isinstance(value, int):
            self.scroll_positions.append(value)
        elif "scrollTo(0, 0)" in script:
            self.scroll_positions.append(0)
        return None

    async def screenshot(self, **options: Any) -> bytes:
        self.screenshot_calls.append(options)
        return self.image


def test_public_website_url_defaults_to_https(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "routes.url_design_inspector.resolve_public_addresses",
        lambda _host: ["93.184.216.34"],
    )
    assert validate_public_website_url("example.com") == "https://example.com"


def test_public_website_url_rejects_private_destinations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject(_host: str) -> list[str]:
        raise ImageDownloadRejected("blocked")

    monkeypatch.setattr(
        "routes.url_design_inspector.resolve_public_addresses",
        reject,
    )
    with pytest.raises(ValueError, match="public internet addresses"):
        validate_public_website_url("http://localhost:7001/private")


@pytest.mark.parametrize(
    "url",
    [
        "file:///C:/secret.html",
        "javascript:alert(1)",
        "https://user:password@example.com",
    ],
)
def test_public_website_url_rejects_unsafe_schemes_and_credentials(
    url: str,
) -> None:
    with pytest.raises(ValueError):
        validate_public_website_url(url)


@pytest.mark.asyncio
async def test_full_page_capture_scrolls_lazy_content_and_uses_full_page() -> None:
    page = FakePage(2_400, png((255, 255, 255)))

    image, metadata = await _capture_responsive_screenshot(
        page,  # type: ignore[arg-type]
        {"width": 1_440, "height": 900},
    )

    assert image
    assert page.scroll_positions[-1] == 0
    assert page.screenshot_calls[0] == {"type": "png", "full_page": True}
    assert metadata["captureHeight"] == 2_400
    assert metadata["fullPage"] is True


@pytest.mark.asyncio
async def test_very_tall_page_is_capped_and_reported() -> None:
    page = FakePage(80_000, png((240, 240, 240)))

    _, metadata = await _capture_responsive_screenshot(
        page,  # type: ignore[arg-type]
        {"width": 1_440, "height": 900},
    )

    expected_height = _bounded_capture_height(1_440, 80_000)
    assert metadata["captureHeight"] == expected_height
    assert metadata["truncated"] is True
    assert page.screenshot_calls[0]["clip"]["height"] == expected_height


def test_blank_screenshot_detection_distinguishes_visible_content() -> None:
    assert png_is_nearly_blank(png((255, 255, 255))) is True
    visible = Image.new("RGB", (64, 64), "white")
    for x in range(32):
        for y in range(64):
            visible.putpixel((x, y), (0, 0, 0))
    output = BytesIO()
    visible.save(output, format="PNG")
    assert png_is_nearly_blank(output.getvalue()) is False


def test_capture_height_respects_pixel_budget() -> None:
    assert _bounded_capture_height(390, 80_000) == MAX_FULL_PAGE_HEIGHT
    assert _bounded_capture_height(2_000, 80_000) == 18_000
