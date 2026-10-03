"""Inspect the public, rendered design system of a website in local Chromium."""

from __future__ import annotations

import asyncio
import base64
import re
import socket
from dataclasses import dataclass
from typing import Any, cast
from urllib.parse import urlsplit

import aiohttp
from aiohttp.abc import AbstractResolver
from fastapi import APIRouter, HTTPException
from playwright.async_api import (
    Route,
    TimeoutError as PlaywrightTimeoutError,
    ViewportSize,
)
from pydantic import BaseModel, Field

from free_images.download import ImageDownloadRejected, resolve_public_addresses
from preview_screenshot import create_screenshot_browser_context

router = APIRouter()

MAX_INSPECT_REQUESTS = 200
MAX_INSPECT_ELEMENTS = 1500
MAX_INSPECT_TOTAL_BYTES = 40 * 1024 * 1024
MAX_INSPECT_RESOURCE_BYTES = 8 * 1024 * 1024
INSPECTION_TIMEOUT_SECONDS = 60
PAGE_TIMEOUT_MS = 20_000
SETTLE_MS = 600
VIEWPORTS: dict[str, ViewportSize] = {
    "desktop": {"width": 1440, "height": 900},
    "tablet": {"width": 768, "height": 1024},
    "mobile": {"width": 390, "height": 844},
}


class WebsiteDesignInspectRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class PublicPinnedResolver(AbstractResolver):
    async def resolve(
        self,
        host: str,
        port: int = 0,
        family: int = socket.AF_INET,
    ) -> list[dict[str, Any]]:
        addresses = await asyncio.to_thread(resolve_public_addresses, host)
        return [
            {
                "hostname": host,
                "host": address,
                "port": port,
                "family": socket.AF_INET6 if ":" in address else socket.AF_INET,
                "proto": 0,
                "flags": 0,
            }
            for address in addresses
        ]

    async def close(self) -> None:
        return None


@dataclass
class InspectionBudget:
    request_count: int = 0
    total_bytes: int = 0


def validate_public_website_url(raw_url: str) -> str:
    candidate = raw_url.strip()
    if not candidate:
        raise ValueError("Enter a public website URL.")
    if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", candidate) and not candidate.lower().startswith(
        ("http:", "https:")
    ):
        raise ValueError("Only public http and https websites can be inspected.")
    if "://" not in candidate:
        candidate = f"https://{candidate}"
    parts = urlsplit(candidate)
    if parts.scheme not in {"http", "https"}:
        raise ValueError("Only public http and https websites can be inspected.")
    if parts.username or parts.password:
        raise ValueError("Website URLs containing credentials are not accepted.")
    host = parts.hostname or ""
    try:
        resolve_public_addresses(host)
    except ImageDownloadRejected as error:
        raise ValueError(
            "The website must resolve only to public internet addresses."
        ) from error
    return candidate


def _png_data_url(data: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


_INSPECTION_SCRIPT = """
({ maxElements }) => {
  const visible = [...document.querySelectorAll("*")]
    .filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
    })
    .slice(0, maxElements);

  const values = (property) => visible
    .map((element) => getComputedStyle(element).getPropertyValue(property).trim())
    .filter(Boolean);
  const count = (items) => {
    const map = new Map();
    for (const item of items) map.set(item, (map.get(item) || 0) + 1);
    return [...map.entries()]
      .map(([value, occurrences]) => ({ value, count: occurrences }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 24);
  };
  const colors = count([
    ...values("color"),
    ...values("background-color"),
    ...values("border-top-color"),
  ].filter((value) =>
    value !== "rgba(0, 0, 0, 0)" && value !== "transparent"
  ));
  const spacing = count([
    ...values("margin-top"), ...values("margin-right"),
    ...values("margin-bottom"), ...values("margin-left"),
    ...values("padding-top"), ...values("padding-right"),
    ...values("padding-bottom"), ...values("padding-left"),
    ...values("gap"),
  ].filter((value) => value !== "0px" && value !== "normal"));
  const rootStyle = getComputedStyle(document.documentElement);
  const customProperties = [...rootStyle]
    .filter((name) => name.startsWith("--"))
    .map((name) => ({ name, value: rootStyle.getPropertyValue(name).trim() }))
    .filter((item) => item.value)
    .slice(0, 48);
  const semanticTags = [
    "button", "a", "input", "select", "textarea", "form", "nav",
    "header", "main", "section", "article", "table", "img", "dialog"
  ];
  const components = semanticTags
    .map((name) => ({ name, count: document.querySelectorAll(name).length }))
    .filter((item) => item.count > 0);
  const assets = new Set();
  for (const image of document.images) {
    if (image.currentSrc) assets.add(image.currentSrc);
  }
  for (const element of visible) {
    const background = getComputedStyle(element).backgroundImage;
    for (const match of background.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)) {
      assets.add(match[1]);
    }
  }
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .slice(0, 80)
    .map((heading) => ({
      level: Number(heading.tagName.slice(1)),
      text: (heading.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 180),
    }))
    .filter((heading) => heading.text);
  const roles = count(visible
    .map((element) => element.getAttribute("role") || element.tagName.toLowerCase())
    .filter(Boolean));

  return {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || "",
    lang: document.documentElement.lang || "",
    inspection: {
      colors,
      customProperties,
      fontFamilies: count(values("font-family")),
      fontSizes: count(values("font-size")),
      fontWeights: count(values("font-weight")),
      lineHeights: count(values("line-height")),
      spacing,
      radii: count(values("border-radius").filter((value) => value !== "0px")),
      shadows: count(values("box-shadow").filter((value) => value !== "none")),
      motion: count([
        ...values("transition-duration"),
        ...values("animation-duration"),
      ].filter((value) => value !== "0s")),
      components,
    },
    accessibility: {
      headings,
      roles,
      landmarks: {
        header: document.querySelectorAll("header,[role=banner]").length,
        nav: document.querySelectorAll("nav,[role=navigation]").length,
        main: document.querySelectorAll("main,[role=main]").length,
        footer: document.querySelectorAll("footer,[role=contentinfo]").length,
      },
      imagesWithoutAlt: [...document.images].filter((image) => !image.hasAttribute("alt")).length,
      unlabeledControls: [...document.querySelectorAll("input,select,textarea,button")]
        .filter((element) => {
          const id = element.id;
          return !element.getAttribute("aria-label") &&
            !element.getAttribute("aria-labelledby") &&
            !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) &&
            !(element.textContent || "").trim();
        }).length,
    },
    assets: [...assets].filter((url) => /^https?:\\/\\//i.test(url)).slice(0, 100),
  };
}
"""


async def inspect_public_website(url: str) -> dict[str, Any]:
    context = None
    page = None
    resolver = PublicPinnedResolver()
    connector = aiohttp.TCPConnector(
        resolver=resolver,
        use_dns_cache=False,
        limit=12,
    )
    session = aiohttp.ClientSession(
        connector=connector,
        timeout=aiohttp.ClientTimeout(total=20),
        auto_decompress=True,
    )
    budget = InspectionBudget()

    async def proxy_public_request(route: Route) -> None:
        request = route.request
        parts = urlsplit(request.url)
        if parts.scheme in {"data", "blob", "about"}:
            await route.continue_()
            return
        budget.request_count += 1
        if (
            budget.request_count > MAX_INSPECT_REQUESTS
            or parts.scheme not in {"http", "https"}
            or not parts.hostname
            or request.method not in {"GET", "HEAD"}
            or request.resource_type == "media"
        ):
            await route.abort("blockedbyclient")
            return

        safe_headers = {
            key: value
            for key, value in request.headers.items()
            if key.lower() in {"accept", "accept-language", "referer", "user-agent"}
        }
        try:
            async with session.request(
                request.method,
                request.url,
                headers=safe_headers,
                allow_redirects=False,
            ) as response:
                chunks: list[bytes] = []
                size = 0
                async for chunk in response.content.iter_chunked(64 * 1024):
                    size += len(chunk)
                    if (
                        size > MAX_INSPECT_RESOURCE_BYTES
                        or budget.total_bytes + size > MAX_INSPECT_TOTAL_BYTES
                    ):
                        raise ValueError("website resource budget exceeded")
                    chunks.append(bytes(chunk))
                budget.total_bytes += size
                response_headers = {
                    key: value
                    for key, value in response.headers.items()
                    if key.lower()
                    in {
                        "cache-control",
                        "content-language",
                        "content-security-policy",
                        "content-type",
                        "etag",
                        "last-modified",
                        "location",
                    }
                }
                await route.fulfill(
                    status=response.status,
                    headers=response_headers,
                    body=b"".join(chunks),
                )
        except (
            aiohttp.ClientError,
            asyncio.TimeoutError,
            ImageDownloadRejected,
            ValueError,
        ):
            await route.abort("blockedbyclient")

    try:
        async with asyncio.timeout(INSPECTION_TIMEOUT_SECONDS):
            context = await create_screenshot_browser_context(
                viewport=VIEWPORTS["desktop"]
            )
            page = await context.new_page()
            await page.add_init_script(
                """
                window.WebSocket = class {
                  constructor() { throw new Error("WebSocket disabled by shot2code"); }
                };
                window.EventSource = class {
                  constructor() { throw new Error("EventSource disabled by shot2code"); }
                };
                """
            )
            page.on("popup", lambda popup: asyncio.create_task(popup.close()))
            await page.route("**/*", proxy_public_request)
            try:
                await page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=PAGE_TIMEOUT_MS,
                )
            except PlaywrightTimeoutError:
                if not await page.locator("body").count():
                    raise
            await page.wait_for_timeout(SETTLE_MS)
            final_url = await asyncio.to_thread(
                validate_public_website_url,
                page.url,
            )
            raw = await page.evaluate(
                _INSPECTION_SCRIPT,
                {"maxElements": MAX_INSPECT_ELEMENTS},
            )
            if not isinstance(raw, dict):
                raise ValueError("The website did not return inspectable design data.")
            result = cast(dict[str, Any], raw)
            screenshots: dict[str, str] = {}
            for name, viewport in VIEWPORTS.items():
                await page.set_viewport_size(viewport)
                await page.wait_for_timeout(250)
                screenshots[name] = _png_data_url(
                    await page.screenshot(type="png", full_page=False)
                )
            result["url"] = final_url
            result["screenshots"] = screenshots
            result["requestCount"] = budget.request_count
            return result
    finally:
        if page is not None:
            await page.close()
        if context is not None:
            await context.close()
        await session.close()


@router.post("/api/design-inspector/url")
async def inspect_website(
    request: WebsiteDesignInspectRequest,
) -> dict[str, Any]:
    try:
        url = await asyncio.to_thread(validate_public_website_url, request.url)
        return await inspect_public_website(url)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except PlaywrightTimeoutError as error:
        raise HTTPException(
            status_code=504,
            detail="The website did not become inspectable before the timeout.",
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "The public website could not be inspected in local Chromium. "
                "Check that it is reachable without signing in."
            ),
        ) from error
