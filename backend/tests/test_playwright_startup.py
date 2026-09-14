import asyncio

import pytest

from preview_screenshot import playwright_backend
from preview_screenshot.playwright_backend import PlaywrightBackend


@pytest.mark.asyncio
async def test_browser_probe_times_out_instead_of_hanging_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class HangingPlaywrightManager:
        async def start(self) -> None:
            await asyncio.Event().wait()

    monkeypatch.setattr(
        playwright_backend,
        "async_playwright",
        lambda: HangingPlaywrightManager(),
    )
    monkeypatch.setattr(
        playwright_backend,
        "BROWSER_LAUNCH_TIMEOUT_SECONDS",
        0.01,
    )

    backend = PlaywrightBackend()

    assert await asyncio.wait_for(backend.available(), timeout=0.5) is False
