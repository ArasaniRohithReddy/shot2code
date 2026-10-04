import asyncio
from contextlib import suppress
from typing import Optional

from playwright.async_api import (
    Browser,
    BrowserContext,
    Playwright,
    TimeoutError as PlaywrightTimeoutError,
    ViewportSize,
    async_playwright,
)

from preview_screenshot.base import VIEWPORT_SIZES
from preview_screenshot.diagnostics import (
    ScreenshotEvidence,
    bounded_runtime_messages,
    png_is_nearly_blank,
)

PAGE_LOAD_TIMEOUT_MS = 15000
RENDER_SETTLE_MS = 250
# Frozen Chromium can spend well over a minute in first-run antivirus scanning.
# This runs in an optional background task, so a larger budget does not delay
# API or window readiness; it only avoids caching a false "unavailable" result.
BROWSER_LAUNCH_TIMEOUT_SECONDS = 150
BROWSER_CLOSE_TIMEOUT_SECONDS = 5


class PlaywrightBackend:
    """Default backend: renders in local headless Chromium.

    Runs locally, so the page can load assets served from localhost
    (e.g. /local-assets/ URLs) that an external screenshot API cannot reach.
    Holds one shared browser, launched lazily and reused across captures.
    """

    def __init__(self) -> None:
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._lock = asyncio.Lock()

    async def _close_unlocked(self) -> None:
        browser = self._browser
        playwright = self._playwright
        self._browser = None
        self._playwright = None

        if browser is not None:
            with suppress(Exception):
                await asyncio.wait_for(
                    browser.close(),
                    timeout=BROWSER_CLOSE_TIMEOUT_SECONDS,
                )
        if playwright is not None:
            with suppress(Exception):
                await asyncio.wait_for(
                    playwright.stop(),
                    timeout=BROWSER_CLOSE_TIMEOUT_SECONDS,
                )

    async def _get_browser(self) -> Browser:
        async with self._lock:
            if self._browser is None or not self._browser.is_connected():
                try:
                    async with asyncio.timeout(BROWSER_LAUNCH_TIMEOUT_SECONDS):
                        if self._playwright is None:
                            self._playwright = await async_playwright().start()
                        # --no-sandbox: Chromium refuses to launch as root (the
                        # user in most hosted Linux environments) unless the
                        # sandbox is disabled.
                        self._browser = await self._playwright.chromium.launch(
                            headless=True,
                            args=["--no-sandbox"],
                        )
                except BaseException:
                    await self._close_unlocked()
                    raise
            if self._browser is None:
                raise RuntimeError("Chromium launch completed without a browser")
            return self._browser

    async def close(self) -> None:
        async with self._lock:
            await self._close_unlocked()

    async def create_context(
        self,
        *,
        viewport: ViewportSize | None = None,
    ) -> BrowserContext:
        browser = await self._get_browser()
        return await browser.new_context(
            viewport=viewport or {"width": 1440, "height": 900},
            device_scale_factor=1,
            service_workers="block",
        )

    async def available(self) -> bool:
        """Launch (and warm up) Chromium; report whether it works.

        Catches every failure mode — missing browser binary, missing Linux
        system libraries, sandbox errors — and logs why it's disabled.
        """
        try:
            await self._get_browser()
            print("[screenshot_preview] Chromium available - tool enabled.")
            return True
        except TimeoutError:
            print(
                "[screenshot_preview] Chromium probe timed out - tool disabled."
            )
            return False
        except Exception as exc:
            # Keep this message ASCII-only: it embeds the upstream error, and a
            # non-encodable character here would raise inside the except block.
            print(
                "[screenshot_preview] Chromium unavailable - tool disabled. "
                "Install it with `cd backend && uv run playwright install "
                "chromium-headless-shell`. "
                f"Cause: {type(exc).__name__}"
            )
            return False

    async def capture(
        self,
        html: str,
        device: str = "desktop",
        full_page: bool = True,
    ) -> bytes:
        return (
            await self.capture_evidence(
                html,
                device=device,
                full_page=full_page,
            )
        ).image

    async def capture_evidence(
        self,
        html: str,
        device: str = "desktop",
        full_page: bool = True,
    ) -> ScreenshotEvidence:
        browser = await self._get_browser()
        width, height = VIEWPORT_SIZES.get(device, VIEWPORT_SIZES["desktop"])
        page = await browser.new_page(
            viewport={"width": width, "height": height},
            device_scale_factor=1,
        )
        console_errors: list[str] = []
        page_errors: list[str] = []
        page.on(
            "console",
            lambda message: (
                console_errors.append(message.text)
                if message.type == "error"
                else None
            ),
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        try:
            try:
                await page.set_content(
                    html,
                    wait_until="networkidle",
                    timeout=PAGE_LOAD_TIMEOUT_MS,
                )
            except PlaywrightTimeoutError:
                # Content is already set; capture whatever rendered if the
                # network never settles (e.g. pages that poll).
                pass
            try:
                await page.evaluate("document.fonts.ready")
            except Exception:
                pass
            await page.wait_for_timeout(RENDER_SETTLE_MS)
            metrics = await page.evaluate(
                """
                () => ({
                  bodyTextChars: (document.body?.innerText || "").trim().length,
                  renderedElements: document.body
                    ? document.body.querySelectorAll("*").length
                    : 0,
                })
                """
            )
            image = await page.screenshot(full_page=full_page, type="png")
            body_text_chars = (
                int(metrics.get("bodyTextChars", 0))
                if isinstance(metrics, dict)
                else 0
            )
            rendered_elements = (
                int(metrics.get("renderedElements", 0))
                if isinstance(metrics, dict)
                else 0
            )
            return ScreenshotEvidence(
                image=image,
                nearly_blank=png_is_nearly_blank(image),
                body_text_chars=body_text_chars,
                rendered_elements=rendered_elements,
                console_errors=bounded_runtime_messages(console_errors),
                page_errors=bounded_runtime_messages(page_errors),
            )
        finally:
            await page.close()
