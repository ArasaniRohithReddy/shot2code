import asyncio
import inspect
from typing import Optional

from babel_cdn import normalize_babel_cdn
from preview_screenshot.base import ScreenshotBackend
from preview_screenshot.playwright_backend import PlaywrightBackend

# The active backend. Defaults to local Chromium; a deployment can swap in an
# alternative (e.g. an external rendering API) via set_screenshot_backend.
_backend: ScreenshotBackend = PlaywrightBackend()

# Cached result of the startup probe: whether _backend can run here. None until
# the first probe runs. Used to gate the tool so it isn't offered when it can't.
_available: Optional[bool] = None
_probe_lock: asyncio.Lock | None = None


def _get_probe_lock() -> asyncio.Lock:
    global _probe_lock
    if _probe_lock is None:
        _probe_lock = asyncio.Lock()
    return _probe_lock


def set_screenshot_backend(backend: ScreenshotBackend) -> None:
    """Install the screenshot backend (call once, before the startup probe)."""
    global _available, _backend, _probe_lock
    _backend = backend
    _available = None
    _probe_lock = None


async def probe_screenshot_preview(force: bool = False) -> bool:
    """Check (once, cached) whether the active backend can run here."""
    global _available
    if _available is not None and not force:
        return _available

    async with _get_probe_lock():
        if _available is not None and not force:
            return _available
        _available = await _backend.available()
    return _available


def is_screenshot_preview_available() -> bool:
    """Synchronous accessor for the cached probe result.

    Defaults to False while discovery is still running. That can temporarily
    omit the optional tool, but cannot advertise Chromium before it has really
    launched.
    """
    return bool(_available)


async def close_screenshot_preview() -> None:
    """Close an active browser/driver when the backend shuts down."""

    close = getattr(_backend, "close", None)
    if callable(close):
        result = close()
        if inspect.isawaitable(result):
            await result


async def capture_preview_screenshot(
    html: str,
    device: str = "desktop",
    full_page: bool = True,
) -> bytes:
    """Render HTML to PNG via the active backend.

    The public entry point the screenshot_preview tool calls; the backend choice
    is invisible to callers. Normalizes the Babel CDN first so generated React
    pages (old and new) actually mount before we capture.
    """
    return await _backend.capture(normalize_babel_cdn(html), device, full_page)
