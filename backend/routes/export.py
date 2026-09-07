import asyncio
import base64
from dataclasses import dataclass
from io import BytesIO
import ipaddress
import json
import re
import socket
from typing import Iterable
from urllib.parse import unquote_to_bytes, urljoin, urlparse
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
from bs4 import BeautifulSoup
from bs4.element import Tag
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

from babel_cdn import normalize_babel_cdn

router = APIRouter()

IMAGE_ATTRIBUTE_SELECTORS = [
    "img[src]",
    "img[srcset]",
    "source[srcset]",
    "image[href]",
    "image[xlink\\:href]",
    "link[rel~='icon'][href]",
    "link[rel='apple-touch-icon'][href]",
]

IMAGE_EXTENSIONS = {
    "apng",
    "avif",
    "gif",
    "jpeg",
    "jpg",
    "png",
    "svg",
    "webp",
}

MIME_EXTENSION_MAP = {
    "image/apng": "apng",
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
}

CSS_URL_RE = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE)
RAW_URL_RE = re.compile(r"https?://[^\s'\"<>\\)]+")
MAX_ASSETS = 50
MAX_ASSET_BYTES = 20 * 1024 * 1024
MAX_REDIRECTS = 5


class ExportRequest(BaseModel):
    code: str
    baseUrl: str | None = None
    # When true the single generated page is split into index.html, styles.css
    # and script.js, with a package.json so it runs as a normal project.
    splitFiles: bool = False
    stack: str | None = None


@dataclass(frozen=True)
class AssetCandidate:
    url: str
    extension_hint: str


@dataclass(frozen=True)
class ExportedAsset:
    path: str
    content: bytes


def is_skippable_asset_url(url: str) -> bool:
    trimmed = url.strip()
    return (
        trimmed == ""
        or trimmed.startswith("#")
        or trimmed.startswith("javascript:")
        or trimmed.startswith("mailto:")
        or trimmed.startswith("tel:")
    )


def extension_from_mime_type(mime_type: str) -> str:
    return MIME_EXTENSION_MAP.get(mime_type.lower().split(";")[0], "bin")


def extension_from_url(url: str) -> str:
    if url.startswith("data:"):
        match = re.match(r"^data:([^;,]+)", url, re.IGNORECASE)
        return extension_from_mime_type(match.group(1)) if match else "bin"

    path = urlparse(url).path or url.split("?", 1)[0].split("#", 1)[0]
    extension = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return extension if extension in IMAGE_EXTENSIONS else "bin"


def is_fetchable_asset_reference(url: str) -> bool:
    trimmed = url.strip()
    if is_skippable_asset_url(trimmed):
        return False
    if trimmed.startswith("data:"):
        return re.match(r"^data:image/", trimmed, re.IGNORECASE) is not None
    if trimmed.startswith("blob:"):
        return False
    return True


def parse_srcset(srcset: str) -> list[str]:
    return [
        part.strip().split()[0]
        for part in srcset.split(",")
        if part.strip().split()
    ]


def extract_css_urls(css: str) -> list[str]:
    return [match.group(2) for match in CSS_URL_RE.finditer(css)]


def tag_attr(tag: Tag, attribute_name: str) -> str | None:
    value = tag.get(attribute_name)
    return value if isinstance(value, str) else None


def add_candidate(candidates: dict[str, AssetCandidate], raw_url: str) -> None:
    url = raw_url.strip()
    if not is_fetchable_asset_reference(url) or url in candidates:
        return
    candidates[url] = AssetCandidate(url=url, extension_hint=extension_from_url(url))


def add_script_url_candidate(
    candidates: dict[str, AssetCandidate], raw_url: str
) -> None:
    url = raw_url.rstrip(".,;:")
    parsed = urlparse(url)
    if parsed.hostname != "replicate.delivery" and extension_from_url(url) == "bin":
        return
    add_candidate(candidates, url)


def display_asset_url(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.netloc:
        return url[:120]
    path = parsed.path
    if len(path) > 80:
        path = f"{path[:36]}...{path[-36:]}"
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def collect_asset_candidates(soup: BeautifulSoup) -> list[AssetCandidate]:
    candidates: dict[str, AssetCandidate] = {}

    for element in soup.select(",".join(IMAGE_ATTRIBUTE_SELECTORS)):
        if not isinstance(element, Tag):
            continue

        for attribute_name in ["src", "href", "xlink:href"]:
            value = tag_attr(element, attribute_name)
            if value:
                add_candidate(candidates, value)

        srcset = tag_attr(element, "srcset")
        if srcset:
            for url in parse_srcset(srcset):
                add_candidate(candidates, url)

    for style_element in soup.select("style"):
        for url in extract_css_urls(style_element.get_text()):
            add_candidate(candidates, url)

    for element in soup.select("[style]"):
        if not isinstance(element, Tag):
            continue
        style = tag_attr(element, "style")
        if style:
            for url in extract_css_urls(style):
                add_candidate(candidates, url)

    for script_element in soup.select("script"):
        script_text = script_element.string
        if not isinstance(script_text, str):
            continue
        for match in RAW_URL_RE.finditer(script_text):
            add_script_url_candidate(candidates, match.group(0))

    return list(candidates.values())[:MAX_ASSETS]


def resolve_fetch_url(url: str, base_url: str | None) -> str | None:
    if url.startswith("data:"):
        return url
    if url.startswith("//"):
        scheme = urlparse(base_url or "").scheme or "https"
        return f"{scheme}:{url}"
    if urlparse(url).scheme in {"http", "https"}:
        return url
    if base_url:
        return urljoin(base_url, url)
    return None


def is_private_ip(ip_address: str) -> bool:
    parsed_ip = ipaddress.ip_address(ip_address)
    return (
        parsed_ip.is_private
        or parsed_ip.is_loopback
        or parsed_ip.is_link_local
        or parsed_ip.is_multicast
        or parsed_ip.is_reserved
        or parsed_ip.is_unspecified
    )


async def is_public_http_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False

    try:
        return not is_private_ip(parsed.hostname)
    except ValueError:
        pass

    try:
        addresses = await asyncio.to_thread(
            socket.getaddrinfo,
            parsed.hostname,
            parsed.port or 443,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror:
        return False

    for address in addresses:
        host = str(address[4][0])
        try:
            if is_private_ip(host):
                return False
        except ValueError:
            return False

    return True


def decode_data_url(data_url: str) -> tuple[bytes, str] | None:
    try:
        header, payload = data_url.split(",", 1)
    except ValueError:
        return None

    mime_type = header[5:].split(";", 1)[0].lower()
    if not mime_type.startswith("image/"):
        return None

    if ";base64" in header.lower():
        content = base64.b64decode(payload, validate=True)
    else:
        content = unquote_to_bytes(payload)

    return content, extension_from_mime_type(mime_type)


async def fetch_remote_asset(
    client: httpx.AsyncClient, fetch_url: str, extension_hint: str
) -> tuple[bytes, str] | None:
    current_url = fetch_url
    response: httpx.Response | None = None

    for _ in range(MAX_REDIRECTS + 1):
        if not await is_public_http_url(current_url):
            print(
                "Export asset skipped: "
                f"reason=non_public_url url={display_asset_url(current_url)}"
            )
            return None

        response = await client.get(current_url, follow_redirects=False)
        if not response.is_redirect:
            break

        location = response.headers.get("location")
        if not location:
            print(
                "Export asset skipped: "
                f"reason=redirect_without_location url={display_asset_url(current_url)}"
            )
            return None
        current_url = urljoin(current_url, location)

    if response is None or response.is_redirect:
        print(
            "Export asset skipped: "
            f"reason=too_many_redirects url={display_asset_url(fetch_url)}"
        )
        return None
    if not response.is_success:
        print(
            "Export asset skipped: "
            f"reason=http_status_{response.status_code} url={display_asset_url(current_url)}"
        )
        return None

    content = response.content
    if len(content) > MAX_ASSET_BYTES:
        print(
            "Export asset skipped: "
            f"reason=too_large bytes={len(content)} url={display_asset_url(current_url)}"
        )
        return None

    content_type = response.headers.get("content-type", "")
    if (
        content_type
        and not content_type.lower().startswith("image/")
        and extension_hint == "bin"
    ):
        print(
            "Export asset skipped: "
            f"reason=non_image_content_type contentType={content_type} "
            f"url={display_asset_url(current_url)}"
        )
        return None

    return content, extension_from_mime_type(content_type)


async def fetch_asset(
    client: httpx.AsyncClient,
    candidate: AssetCandidate,
    asset_index: int,
    base_url: str | None,
) -> ExportedAsset | None:
    fetch_url = resolve_fetch_url(candidate.url, base_url)
    if not fetch_url:
        print(
            "Export asset skipped: "
            f"reason=unresolved_relative_url url={display_asset_url(candidate.url)}"
        )
        return None

    try:
        if fetch_url.startswith("data:"):
            decoded = decode_data_url(fetch_url)
        else:
            decoded = await fetch_remote_asset(
                client, fetch_url, candidate.extension_hint
            )
    except Exception as exc:
        print(
            "Export asset skipped: "
            f"reason={type(exc).__name__} url={display_asset_url(fetch_url)}"
        )
        return None

    if not decoded:
        return None

    content, mime_extension = decoded
    extension = (
        candidate.extension_hint
        if candidate.extension_hint != "bin"
        else mime_extension
    )
    return ExportedAsset(
        path=f"assets/image-{asset_index + 1}.{extension}", content=content
    )


def rewrite_srcset(srcset: str, asset_path_by_url: dict[str, str]) -> str:
    rewritten_parts: list[str] = []
    for part in srcset.split(","):
        trimmed = part.strip()
        tokens = trimmed.split()
        if not tokens:
            rewritten_parts.append(part)
            continue

        asset_path = asset_path_by_url.get(tokens[0])
        rewritten_parts.append(
            " ".join([asset_path, *tokens[1:]]) if asset_path else part
        )

    return ", ".join(rewritten_parts)


def rewrite_css_urls(css: str, asset_path_by_url: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        quote = match.group(1)
        url = match.group(2).strip()
        asset_path = asset_path_by_url.get(url)
        if not asset_path:
            return match.group(0)
        return f"url({quote}{asset_path}{quote})"

    return CSS_URL_RE.sub(replace, css)


def rewrite_html_assets(soup: BeautifulSoup, asset_path_by_url: dict[str, str]) -> None:
    for element in soup.select(",".join(IMAGE_ATTRIBUTE_SELECTORS)):
        if not isinstance(element, Tag):
            continue

        for attribute_name in ["src", "href", "xlink:href"]:
            value = tag_attr(element, attribute_name)
            if not value:
                continue
            asset_path = asset_path_by_url.get(value.strip())
            if asset_path:
                element[attribute_name] = asset_path

        srcset = tag_attr(element, "srcset")
        if srcset:
            element["srcset"] = rewrite_srcset(srcset, asset_path_by_url)

    for style_element in soup.select("style"):
        style_element.string = rewrite_css_urls(style_element.get_text(), asset_path_by_url)

    for element in soup.select("[style]"):
        if not isinstance(element, Tag):
            continue
        style = tag_attr(element, "style")
        if style:
            element["style"] = rewrite_css_urls(style, asset_path_by_url)


def rewrite_raw_asset_urls(index_html: str, asset_path_by_url: dict[str, str]) -> str:
    for original_url, asset_path in asset_path_by_url.items():
        index_html = index_html.replace(original_url, asset_path)
        index_html = index_html.replace(original_url.replace("/", "\\/"), asset_path)
    return index_html


def create_project_zip(
    index_html: str,
    assets: Iterable[ExportedAsset],
    extra_files: dict[str, str] | None = None,
) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as zip_file:
        if extra_files and "index.html" in extra_files:
            # A split export supplies its own index.html alongside the
            # extracted stylesheet and script.
            for path, content in extra_files.items():
                zip_file.writestr(path, content)
        else:
            zip_file.writestr("index.html", index_html)
            for path, content in (extra_files or {}).items():
                zip_file.writestr(path, content)
        for asset in assets:
            zip_file.writestr(asset.path, asset.content)

    return buffer.getvalue()


def split_single_file_html(html: str) -> dict[str, str]:
    """Split a generated page into index.html, styles.css and script.js.

    Generation always produces one self-contained HTML file, because that is
    what the preview renders and what the agent edits. People who want to keep
    working on the result would rather have the usual separate files, so pull
    the inline <style> and inline <script> blocks out and link them back in.

    Only inline blocks move. Anything with a src/href (the CDN tags every stack
    relies on) is left exactly where it is.
    """
    soup = BeautifulSoup(html, "html.parser")

    styles: list[str] = []
    for style_tag in soup.find_all("style"):
        if not isinstance(style_tag, Tag):
            continue
        text = style_tag.get_text()
        if text.strip():
            styles.append(text.strip())
        style_tag.decompose()

    scripts: list[str] = []
    for script_tag in soup.find_all("script"):
        if not isinstance(script_tag, Tag):
            continue
        # Leave CDN includes and module imports alone; they must stay in the
        # document to keep load order and module resolution working.
        if script_tag.get("src") or script_tag.get("type") == "module":
            continue
        text = script_tag.get_text()
        if text.strip():
            scripts.append(text.strip())
            script_tag.decompose()

    if styles:
        head = soup.head or soup
        link = soup.new_tag("link", rel="stylesheet", href="styles.css")
        head.append(link)

    if scripts:
        body = soup.body or soup
        script = soup.new_tag("script", src="script.js")
        body.append(script)

    files = {"index.html": str(soup)}
    if styles:
        files["styles.css"] = "\n\n".join(styles) + "\n"
    if scripts:
        files["script.js"] = "\n\n".join(scripts) + "\n"
    return files


def build_project_scaffold(stack: str | None) -> dict[str, str]:
    """package.json and README so the export runs like a normal project."""
    name = "shot2code-export"
    package_json = json.dumps(
        {
            "name": name,
            "private": True,
            "version": "0.1.0",
            "scripts": {
                "dev": "vite",
                "build": "vite build",
                "preview": "vite preview",
            },
            "devDependencies": {"vite": "^6.0.0"},
        },
        indent=2,
    )

    stack_line = f"Generated for the **{stack}** stack.\n\n" if stack else ""
    readme = f"""# {name}

Exported from shot2code.

{stack_line}## Running it

```bash
npm install
npm run dev
```

Or just open `index.html` in a browser - the page is self-contained and loads
its framework from a CDN, so no build step is required.

## Files

- `index.html` - markup, plus the CDN tags for this stack
- `styles.css` - styles that were inline in the generated page
- `script.js` - scripts that were inline in the generated page
- `assets/` - images referenced by the page, downloaded locally

Inline `<script type="module">` blocks stay in `index.html`, because moving
them would break module resolution and load order.
"""
    return {"package.json": package_json + "\n", "README.md": readme}


@router.post("/api/export")
async def export_code(request: ExportRequest) -> Response:
    soup = BeautifulSoup(normalize_babel_cdn(request.code), "html.parser")
    candidates = collect_asset_candidates(soup)

    async with httpx.AsyncClient(
        timeout=20,
        headers={"User-Agent": "screenshot-to-code-export/1.0"},
    ) as client:
        fetched_assets = await asyncio.gather(
            *[
                fetch_asset(client, candidate, index, request.baseUrl)
                for index, candidate in enumerate(candidates)
            ]
        )

    assets = [asset for asset in fetched_assets if asset is not None]
    asset_path_by_url = {
        candidates[index].url: asset.path
        for index, asset in enumerate(fetched_assets)
        if asset is not None
    }

    if asset_path_by_url:
        rewrite_html_assets(soup, asset_path_by_url)

    index_html = rewrite_raw_asset_urls(str(soup), asset_path_by_url)

    extra_files: dict[str, str] = {}
    if request.splitFiles:
        extra_files.update(split_single_file_html(index_html))
        extra_files.update(build_project_scaffold(request.stack))

    zip_content = create_project_zip(index_html, assets, extra_files)
    print(
        "Export complete: "
        f"candidates={len(candidates)} assets={len(assets)} "
        f"skipped={len(candidates) - len(assets)} split={request.splitFiles} "
        f"responseBytes={len(zip_content)}"
    )
    return Response(
        content=zip_content,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="shot2code-export.zip"'
        },
    )
