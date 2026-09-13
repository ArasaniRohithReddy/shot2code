import asyncio
import base64
from dataclasses import dataclass
from io import BytesIO
import ipaddress
import json
from pathlib import PurePosixPath, PureWindowsPath
import posixpath
import re
import socket
from typing import Iterable, Literal, cast
from urllib.parse import unquote_to_bytes, urljoin, urlparse
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
from bs4 import BeautifulSoup
from bs4.element import Tag
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from babel_cdn import normalize_babel_cdn

router = APIRouter()

ASSET_ATTRIBUTE_SELECTORS = [
    "img[src]",
    "img[srcset]",
    "source[srcset]",
    "image[href]",
    "image[xlink\\:href]",
    "link[rel~='icon'][href]",
    "link[rel='apple-touch-icon'][href]",
    "link[rel~='preload'][as='image'][href]",
    "link[rel~='preload'][as='font'][href]",
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
FONT_EXTENSIONS = {"eot", "otf", "ttf", "woff", "woff2"}
ASSET_EXTENSIONS = IMAGE_EXTENSIONS | FONT_EXTENSIONS

MIME_EXTENSION_MAP = {
    "application/font-woff": "woff",
    "application/vnd.ms-fontobject": "eot",
    "font/eot": "eot",
    "font/otf": "otf",
    "font/sfnt": "ttf",
    "font/ttf": "ttf",
    "font/woff": "woff",
    "font/woff2": "woff2",
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
MAX_PROJECT_FILES = 400
MAX_PROJECT_FILE_BYTES = 600_000
MAX_PROJECT_TOTAL_BYTES = 12 * 1024 * 1024

ProjectKind = Literal["vite_html", "vite_react", "vite_preact"]

TAILWIND_CDN = "https://cdn.tailwindcss.com/3.4.17"
BOOTSTRAP_CDN = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"
BOOTSTRAP_JS_CDN = (
    "https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"
)
REACT_CDN = "https://cdn.jsdelivr.net/npm/react@18.0.0/umd/react.development.js"
REACT_DOM_CDN = "https://cdn.jsdelivr.net/npm/react-dom@18.0.0/umd/react-dom.development.js"
BABEL_CDN = "https://unpkg.com/@babel/standalone@7.25.6/babel.min.js"
IONIC_MODULE_CDN = (
    "https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/dist/ionic/ionic.esm.js"
)
IONIC_CSS_CDN = (
    "https://cdn.jsdelivr.net/npm/@ionic/core@8.8.19/css/ionic.bundle.css"
)
VUE_CDN = "https://unpkg.com/vue@3.5.42/dist/vue.global.js"
ALPINE_CDN = "https://cdn.jsdelivr.net/npm/alpinejs@3.17.1/dist/cdn.min.js"
PREACT_CDN = "https://esm.sh/preact@10.29.8"
PREACT_HOOKS_CDN = "https://esm.sh/preact@10.29.8/hooks"
HTM_CDN = "https://esm.sh/htm@3.1.1"
DAISYUI_CDN = "https://cdn.jsdelivr.net/npm/daisyui@4.12.14/dist/full.min.css"
BULMA_CDN = "https://cdn.jsdelivr.net/npm/bulma@1.0.2/css/bulma.min.css"
MATERIAL_SYMBOLS_CSS = (
    "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:"
    "opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
)
MATERIAL_WEB_CDN = "https://esm.run/@material/web@2.5.0/all.js"
MATERIAL_WEB_TYPESCALE_CDN = (
    "https://esm.run/@material/web@2.5.0/typography/md-typescale-styles.js"
)
HTMX_CDN = "https://cdn.jsdelivr.net/npm/htmx.org@2.0.4/dist/htmx.min.js"


@dataclass(frozen=True)
class ExportStrategy:
    project_kind: ProjectKind
    project_notes: str
    codepen_resources: tuple[str, ...]


EXPORT_STRATEGIES: dict[str, ExportStrategy] = {
    "html_tailwind": ExportStrategy(
        "vite_html",
        "Vite HTML project; the Tailwind browser runtime stays on its pinned CDN.",
        (TAILWIND_CDN,),
    ),
    "html_css": ExportStrategy(
        "vite_html",
        "Vite HTML project with plain HTML, CSS, and JavaScript.",
        (),
    ),
    "react_tailwind": ExportStrategy(
        "vite_react",
        "Vite React project when the canonical single Babel module can be lifted safely; otherwise a documented Vite HTML fallback.",
        (REACT_CDN, REACT_DOM_CDN, BABEL_CDN, TAILWIND_CDN),
    ),
    "bootstrap": ExportStrategy(
        "vite_html",
        "Vite HTML project retaining Bootstrap CDN resources and their load order.",
        (BOOTSTRAP_CDN, BOOTSTRAP_JS_CDN),
    ),
    "vue_tailwind": ExportStrategy(
        "vite_html",
        "Vite HTML project retaining the working Vue global-build application instead of inventing an SFC transform.",
        (VUE_CDN, TAILWIND_CDN),
    ),
    "ionic_tailwind": ExportStrategy(
        "vite_html",
        "Vite HTML project retaining Ionic custom-element modules, styles, and Tailwind CDN resources.",
        (IONIC_MODULE_CDN, IONIC_CSS_CDN, TAILWIND_CDN),
    ),
    "alpine_tailwind": ExportStrategy(
        "vite_html",
        "Vite HTML project retaining Alpine directives and its deferred CDN runtime.",
        (ALPINE_CDN, TAILWIND_CDN),
    ),
    "preact_tailwind": ExportStrategy(
        "vite_preact",
        "Vite Preact project when the canonical esm.sh Preact/HTM module can be mapped to npm dependencies; otherwise a documented Vite HTML fallback.",
        (PREACT_CDN, PREACT_HOOKS_CDN, HTM_CDN, TAILWIND_CDN),
    ),
    "tailwind_daisyui": ExportStrategy(
        "vite_html",
        "Vite HTML project retaining the matched Tailwind and daisyUI browser resources.",
        (TAILWIND_CDN, DAISYUI_CDN),
    ),
    "bulma": ExportStrategy(
        "vite_html",
        "Vite HTML project retaining the pinned Bulma stylesheet.",
        (BULMA_CDN,),
    ),
    "material_web": ExportStrategy(
        "vite_html",
        "Vite HTML project retaining Material Web ESM imports and import order.",
        (MATERIAL_SYMBOLS_CSS, MATERIAL_WEB_CDN, MATERIAL_WEB_TYPESCALE_CDN),
    ),
    "htmx_tailwind": ExportStrategy(
        "vite_html",
        "Vite HTML project retaining htmx and Tailwind browser resources.",
        (HTMX_CDN, TAILWIND_CDN),
    ),
}

DEFAULT_EXPORT_STRATEGY = ExportStrategy(
    "vite_html",
    "Vite HTML project preserving the generated document without framework source extraction.",
    (),
)


class ExportProjectFile(BaseModel):
    path: str
    content: str


class ExportProjectPayload(BaseModel):
    entryPoint: str
    files: list[ExportProjectFile]


class ExportRequest(BaseModel):
    code: str
    baseUrl: str | None = None
    # When true the single generated page is split into index.html, styles.css
    # and script.js, with a package.json so it runs as a normal project.
    splitFiles: bool = False
    stack: str | None = None
    project: ExportProjectPayload | None = None


@dataclass(frozen=True)
class AssetCandidate:
    url: str
    extension_hint: str


@dataclass(frozen=True)
class ExportedAsset:
    path: str
    content: bytes


@dataclass(frozen=True)
class FetchedAsset:
    content: bytes
    extension: str


@dataclass(frozen=True)
class NormalizedProjectPayload:
    entry_point: str
    files: dict[str, str]


def normalize_archive_path(raw_path: str) -> str:
    path = raw_path.strip().replace("\\", "/")
    windows_path = PureWindowsPath(path)
    posix_path = PurePosixPath(path)
    invalid_characters = set('<>:"|?*')

    if (
        not path
        or "\x00" in path
        or windows_path.drive
        or windows_path.root
        or posix_path.is_absolute()
    ):
        raise HTTPException(status_code=400, detail="Project file paths must be relative")

    parts = path.split("/")
    if any(
        not part
        or part in {".", ".."}
        or part.rstrip(" .") != part
        or any(
            character in invalid_characters or ord(character) < 32
            for character in part
        )
        for part in parts
    ):
        raise HTTPException(
            status_code=400, detail=f"Unsafe project file path: {raw_path}"
        )

    return "/".join(parts)


def normalize_project_payload(project: ExportProjectPayload) -> NormalizedProjectPayload:
    if not project.files:
        raise HTTPException(
            status_code=400, detail="Project export requires at least one file"
        )
    if len(project.files) > MAX_PROJECT_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Project export supports at most {MAX_PROJECT_FILES} files",
        )

    files: dict[str, str] = {}
    paths_by_casefold: dict[str, str] = {}
    total_bytes = 0
    for project_file in project.files:
        path = normalize_archive_path(project_file.path)
        path_key = path.casefold()
        if path_key in paths_by_casefold:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate project file path: {path}",
            )

        content_bytes = project_file.content.encode("utf-8")
        if len(content_bytes) > MAX_PROJECT_FILE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"Project file is too large: {path}",
            )
        total_bytes += len(content_bytes)
        if total_bytes > MAX_PROJECT_TOTAL_BYTES:
            raise HTTPException(
                status_code=400,
                detail="Project export exceeds the total source size limit",
            )

        paths_by_casefold[path_key] = path
        files[path] = project_file.content

    requested_entry_point = normalize_archive_path(project.entryPoint)
    entry_point = paths_by_casefold.get(requested_entry_point.casefold())
    if entry_point is None:
        raise HTTPException(
            status_code=400,
            detail="Project entry point must reference an included file",
        )

    return NormalizedProjectPayload(entry_point=entry_point, files=files)


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
    return extension if extension in ASSET_EXTENSIONS else "bin"


def is_fetchable_asset_reference(url: str) -> bool:
    trimmed = url.strip()
    if is_skippable_asset_url(trimmed):
        return False
    if trimmed.startswith("data:"):
        return (
            re.match(
                r"^data:(?:image/|font/|application/font-woff|application/vnd\.ms-fontobject)",
                trimmed,
                re.IGNORECASE,
            )
            is not None
        )
    if trimmed.startswith("blob:"):
        return False
    return True


def parse_srcset_candidates(srcset: str) -> list[tuple[str, str]]:
    """Parse srcset without splitting commas that belong to data URLs."""
    candidates: list[tuple[str, str]] = []
    position = 0
    whitespace = " \t\n\f\r"

    while position < len(srcset):
        while position < len(srcset) and srcset[position] in whitespace + ",":
            position += 1
        if position >= len(srcset):
            break

        url_start = position
        is_data_url = srcset[position : position + 5].casefold() == "data:"
        while position < len(srcset):
            character = srcset[position]
            if character in whitespace or (character == "," and not is_data_url):
                break
            position += 1
        url = srcset[url_start:position]

        if url.endswith(","):
            url = url.rstrip(",")
            if url:
                candidates.append((url, ""))
            continue

        while position < len(srcset) and srcset[position] in whitespace:
            position += 1

        descriptor_start = position
        parentheses = 0
        while position < len(srcset):
            character = srcset[position]
            if character == "(":
                parentheses += 1
            elif character == ")" and parentheses:
                parentheses -= 1
            elif character == "," and parentheses == 0:
                break
            position += 1

        descriptor = srcset[descriptor_start:position].strip()
        if position < len(srcset) and srcset[position] == ",":
            position += 1
        if url:
            candidates.append((url, descriptor))

    return candidates


def parse_srcset(srcset: str) -> list[str]:
    return [url for url, _descriptor in parse_srcset_candidates(srcset)]


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

    for element in soup.select(",".join(ASSET_ATTRIBUTE_SELECTORS)):
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


MARKUP_SOURCE_SUFFIXES = {".htm", ".html", ".jsx", ".svg", ".tsx", ".vue"}
ASSET_SOURCE_SUFFIXES = MARKUP_SOURCE_SUFFIXES | {
    ".css",
    ".js",
    ".less",
    ".mjs",
    ".sass",
    ".scss",
    ".ts",
}


def collect_project_asset_candidates(files: dict[str, str]) -> list[AssetCandidate]:
    candidates: dict[str, AssetCandidate] = {}

    for path, content in files.items():
        suffix = PurePosixPath(path).suffix.casefold()
        if suffix not in ASSET_SOURCE_SUFFIXES:
            continue

        if suffix in MARKUP_SOURCE_SUFFIXES:
            soup = BeautifulSoup(content, "html.parser")
            for candidate in collect_asset_candidates(soup):
                add_candidate(candidates, candidate.url)

        for url in extract_css_urls(content):
            add_candidate(candidates, url)
        for match in RAW_URL_RE.finditer(content):
            add_script_url_candidate(candidates, match.group(0))

        if len(candidates) >= MAX_ASSETS:
            break

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
    if extension_from_mime_type(mime_type) == "bin":
        return None

    if ";base64" in header.lower():
        content = base64.b64decode(payload, validate=True)
    else:
        content = unquote_to_bytes(payload)
    if len(content) > MAX_ASSET_BYTES:
        return None

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
    normalized_content_type = content_type.lower().split(";", 1)[0]
    supported_content_type = (
        normalized_content_type.startswith(("image/", "font/"))
        or normalized_content_type
        in {"application/font-woff", "application/vnd.ms-fontobject"}
    )
    if content_type and not supported_content_type:
        is_known_binary = (
            normalized_content_type == "application/octet-stream"
            and extension_hint in ASSET_EXTENSIONS
        )
        if not is_known_binary:
            print(
                "Export asset skipped: "
                f"reason=unsupported_content_type contentType={content_type} "
                f"url={display_asset_url(current_url)}"
            )
            return None

    return content, extension_from_mime_type(content_type)


async def fetch_asset(
    client: httpx.AsyncClient,
    candidate: AssetCandidate,
    base_url: str | None,
) -> FetchedAsset | None:
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

    return fetched_asset_from_decoded(candidate, decoded)


def fetched_asset_from_decoded(
    candidate: AssetCandidate, decoded: tuple[bytes, str]
) -> FetchedAsset:
    content, mime_extension = decoded
    extension = (
        candidate.extension_hint
        if candidate.extension_hint != "bin"
        else mime_extension
    )
    return FetchedAsset(content=content, extension=extension)


def materialize_assets(
    candidates: list[AssetCandidate],
    fetched_assets: list[FetchedAsset | None],
    reserved_paths: Iterable[str] = (),
) -> tuple[list[ExportedAsset], dict[str, str]]:
    used_paths = {path.casefold() for path in reserved_paths}
    assets: list[ExportedAsset] = []
    asset_path_by_url: dict[str, str] = {}

    for index, fetched_asset in enumerate(fetched_assets):
        if fetched_asset is None:
            continue

        stem = f"assets/image-{index + 1}"
        path = f"{stem}.{fetched_asset.extension}"
        collision_index = 2
        while path.casefold() in used_paths:
            path = f"{stem}-{collision_index}.{fetched_asset.extension}"
            collision_index += 1

        used_paths.add(path.casefold())
        assets.append(ExportedAsset(path=path, content=fetched_asset.content))
        asset_path_by_url[candidates[index].url] = path

    return assets, asset_path_by_url


async def download_assets(
    candidates: list[AssetCandidate],
    base_url: str | None,
    reserved_paths: Iterable[str] = (),
) -> tuple[list[ExportedAsset], dict[str, str]]:
    if not candidates:
        return [], {}

    fetched_assets: list[FetchedAsset | None] = [None] * len(candidates)
    remote_indices: list[int] = []
    for index, candidate in enumerate(candidates):
        fetch_url = resolve_fetch_url(candidate.url, base_url)
        if fetch_url and fetch_url.startswith("data:"):
            try:
                decoded = decode_data_url(fetch_url)
            except Exception as exc:
                print(
                    "Export asset skipped: "
                    f"reason={type(exc).__name__} url={display_asset_url(fetch_url)}"
                )
                continue
            if decoded is not None:
                fetched_assets[index] = fetched_asset_from_decoded(candidate, decoded)
        else:
            remote_indices.append(index)

    if remote_indices:
        async with httpx.AsyncClient(
            timeout=20,
            headers={"User-Agent": "screenshot-to-code-export/1.0"},
        ) as client:
            remote_assets = await asyncio.gather(
                *[
                    fetch_asset(client, candidates[index], base_url)
                    for index in remote_indices
                ]
            )
        for index, fetched_asset in zip(remote_indices, remote_assets):
            fetched_assets[index] = fetched_asset

    return materialize_assets(candidates, fetched_assets, reserved_paths)


def rewrite_srcset(srcset: str, asset_path_by_url: dict[str, str]) -> str:
    rewritten_parts: list[str] = []
    for url, descriptor in parse_srcset_candidates(srcset):
        rewritten_url = asset_path_by_url.get(url, url)
        rewritten_parts.append(
            f"{rewritten_url} {descriptor}" if descriptor else rewritten_url
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
    for element in soup.select(",".join(ASSET_ATTRIBUTE_SELECTORS)):
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
    ordered_urls = sorted(asset_path_by_url, key=len, reverse=True)
    for original_url in ordered_urls:
        asset_path = asset_path_by_url[original_url]
        index_html = index_html.replace(original_url, asset_path)
        index_html = index_html.replace(original_url.replace("/", "\\/"), asset_path)
    return index_html


def relative_asset_path(source_path: str, asset_path: str) -> str:
    source_directory = posixpath.dirname(source_path) or "."
    return posixpath.relpath(asset_path, source_directory)


def rewrite_project_asset_urls(
    files: dict[str, str], asset_path_by_url: dict[str, str]
) -> dict[str, str]:
    rewritten_files: dict[str, str] = {}
    ordered_urls = sorted(asset_path_by_url, key=len, reverse=True)

    for path, content in files.items():
        if PurePosixPath(path).suffix.casefold() not in ASSET_SOURCE_SUFFIXES:
            rewritten_files[path] = content
            continue

        rewritten = content
        for original_url in ordered_urls:
            asset_path = relative_asset_path(path, asset_path_by_url[original_url])
            rewritten = rewritten.replace(original_url, asset_path)
            rewritten = rewritten.replace(
                original_url.replace("/", "\\/"), asset_path
            )
        rewritten_files[path] = rewritten

    return rewritten_files


def create_project_zip(
    index_html: str,
    assets: Iterable[ExportedAsset],
    extra_files: dict[str, str] | None = None,
) -> bytes:
    files = extra_files if extra_files is not None else {"index.html": index_html}
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as zip_file:
        for path, content in files.items():
            zip_file.writestr(path, content)
        for asset in assets:
            zip_file.writestr(asset.path, asset.content)

    return buffer.getvalue()


REACT_NAMED_IMPORTS = (
    "createContext",
    "Fragment",
    "memo",
    "useCallback",
    "useContext",
    "useEffect",
    "useId",
    "useLayoutEffect",
    "useMemo",
    "useReducer",
    "useRef",
    "useState",
)
CLASSIC_SCRIPT_TYPES = {
    "",
    "application/ecmascript",
    "application/javascript",
    "text/ecmascript",
    "text/javascript",
}


@dataclass(frozen=True)
class ProjectExport:
    files: dict[str, str]
    project_kind: str


def get_export_strategy(stack: str | None) -> ExportStrategy:
    return EXPORT_STRATEGIES.get(stack or "", DEFAULT_EXPORT_STRATEGY)


def export_archive_filename(stack: str | None, split_files: bool) -> str:
    stack_slug = re.sub(r"[^a-z0-9]+", "-", (stack or "web").lower()).strip("-")
    safe_stack = stack_slug or "web"
    mode = "project" if split_files else "single-html"
    return f"shot2code-{safe_stack}-{mode}.zip"


def package_name(stack: str | None) -> str:
    stack_slug = re.sub(r"[^a-z0-9]+", "-", (stack or "web").lower()).strip("-")
    return f"shot2code-{stack_slug or 'web'}"


def build_package_json(
    stack: str | None,
    dependencies: dict[str, str] | None = None,
    *,
    react_plugin: bool = False,
    static_build: bool = False,
) -> str:
    dev_dependencies = {"vite": "^6.0.0"}
    if react_plugin:
        dev_dependencies["@vitejs/plugin-react"] = "^4.3.4"

    package: dict[str, object] = {
        "name": package_name(stack),
        "private": True,
        "version": "0.1.0",
        "type": "module",
        "scripts": {
            "dev": "vite",
            "build": "node build.mjs" if static_build else "vite build",
            "preview": "vite preview",
        },
        "devDependencies": dev_dependencies,
    }
    if dependencies:
        package["dependencies"] = dependencies
    return json.dumps(package, indent=2) + "\n"


def build_static_copy_script() -> str:
    return '''import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
for (const path of ["index.html", "styles.css", "script.js"]) {
  if (existsSync(path)) {
    copyFileSync(path, join("dist", path));
  }
}
if (existsSync("assets")) {
  cpSync("assets", join("dist", "assets"), { recursive: true });
}
'''


def build_static_vite_config() -> str:
    return '''import { defineConfig } from "vite";

export default defineConfig({ base: "./" });
'''


def build_vite_config(*, react_plugin: bool = False) -> str:
    react_import = 'import react from "@vitejs/plugin-react";\n' if react_plugin else ""
    plugins = "react(), copyStaticFiles()" if react_plugin else "copyStaticFiles()"
    return f'''import {{ cpSync, copyFileSync, existsSync, mkdirSync, realpathSync }} from "node:fs";
import {{ join, resolve }} from "node:path";
import {{ defineConfig }} from "vite";
{react_import}
const copyStaticFiles = () => ({{
  name: "shot2code-copy-static",
  closeBundle() {{
    mkdirSync("dist", {{ recursive: true }});
    if (existsSync("assets")) {{
      cpSync("assets", join("dist", "assets"), {{ recursive: true }});
    }}
    if (existsSync("script.js")) {{
      copyFileSync("script.js", join("dist", "script.js"));
    }}
  }},
}});

export default defineConfig({{
  root: realpathSync.native(resolve(".")),
  base: "./",
  plugins: [{plugins}],
  build: {{
    rollupOptions: {{
      external: (id) => id.startsWith("http://") || id.startsWith("https://"),
    }},
  }},
}});
'''


def build_project_readme(
    stack: str | None,
    strategy: ExportStrategy,
    project_kind: str,
    fallback_reason: str | None = None,
) -> str:
    stack_name = (stack or "unspecified").replace("`", "")
    fallback = ""
    if fallback_reason:
        fallback = f'''\n## Safe fallback

{fallback_reason} The original working HTML and CDN/module tags were retained
instead of emitting source files that could look valid but fail at build time.
'''

    if project_kind == "vite_react":
        files = '''- `index.html` - original document shell and non-React external resources
- `src/App.jsx` - generated JSX and its original mount logic
- `src/main.jsx` - Vite entry point
- `src/styles.css` - safely extracted project stylesheet, linked at its original position
- `assets/` - downloaded images and fonts; copied into `dist/assets`
'''
    elif project_kind == "vite_preact":
        files = '''- `index.html` - original document shell and non-Preact external resources
- `src/main.js` - generated HTM application with npm Preact imports
- `src/styles.css` - safely extracted project stylesheet, linked at its original position
- `assets/` - downloaded images and fonts; copied into `dist/assets`
'''
    else:
        files = '''- `index.html` - markup plus required CDN and inline module tags
- `styles.css` - a safely extracted plain CSS block, or an empty extension point
- `script.js` - a safely extracted classic script, or an empty extension point
- `build.mjs` - deterministic static copy build that preserves browser execution order
- `assets/` - downloaded images and fonts; copied into `dist/assets`
'''

    build_description = (
        "`npm run build` copies the working HTML, CSS, JavaScript, and assets "
        "unchanged into `dist/`; it deliberately does not rebundle inline modules."
        if project_kind == "vite_html"
        else "`npm run build` bundles the framework source into `dist/`."
    )

    return f'''# {package_name(stack)}

Exported from shot2code for the `{stack_name}` stack.

{strategy.project_notes}

## Run and build

```bash
npm install
npm run dev
npm run build
npm run preview
```

{build_description} HTTP(S) CDN resources remain external by design, while
downloaded assets are copied into the build.

## Files

{files}
Inline ES modules, import maps, non-JavaScript script blocks, and unsafe-to-move
inline resources stay in `index.html` so their execution and cascade order do
not change.
{fallback}
'''


def is_plain_style_tag(tag: Tag) -> bool:
    style_type = str(tag.get("type") or "").strip().lower()
    return style_type in {"", "text/css"} and set(tag.attrs) <= {"type"}


def extract_safe_style(soup: BeautifulSoup, href: str) -> str:
    candidates = [
        tag
        for tag in soup.find_all("style")
        if isinstance(tag, Tag) and is_plain_style_tag(tag) and tag.get_text().strip()
    ]
    content = "/* Add project styles here. */\n"
    if len(candidates) == 1:
        style_tag = candidates[0]
        content = style_tag.get_text().strip() + "\n"
        link = soup.new_tag("link", rel="stylesheet", href=href)
        style_tag.replace_with(link)
    elif not soup.find("link", href=href):
        (soup.head or soup).append(soup.new_tag("link", rel="stylesheet", href=href))
    return content


def is_classic_script_tag(tag: Tag) -> bool:
    script_type = str(tag.get("type") or "").strip().lower()
    return (
        not tag.get("src")
        and script_type in CLASSIC_SCRIPT_TYPES
        and set(tag.attrs) <= {"type"}
    )


def extract_safe_script(soup: BeautifulSoup, src: str) -> str:
    candidates = [
        tag
        for tag in soup.find_all("script")
        if isinstance(tag, Tag)
        and is_classic_script_tag(tag)
        and tag.get_text().strip()
        and "document.currentScript" not in tag.get_text()
    ]
    content = "// Add project scripts here.\n"
    if len(candidates) == 1:
        script_tag = candidates[0]
        content = script_tag.get_text().strip() + "\n"
        attributes: dict[str, str] = {"src": src}
        script_type = tag_attr(script_tag, "type")
        if script_type:
            attributes["type"] = script_type
        replacement = soup.new_tag("script", attrs=attributes)
        replacement.string = ""
        script_tag.replace_with(replacement)
    elif not soup.find("script", src=src):
        target = soup.body or soup
        script = soup.new_tag("script", src=src)
        script.string = ""
        target.append(script)
    return content


def framework_stylesheet(soup: BeautifulSoup) -> str | None:
    nonempty_styles = [
        tag
        for tag in soup.find_all("style")
        if isinstance(tag, Tag) and tag.get_text().strip()
    ]
    if len(nonempty_styles) > 1 or any(
        not is_plain_style_tag(tag) for tag in nonempty_styles
    ):
        return None

    for tag in list(soup.find_all("style")):
        if isinstance(tag, Tag) and not tag.get_text().strip():
            tag.decompose()

    css = extract_safe_style(soup, "/src/styles.css")

    def adjust_asset_path(match: re.Match[str]) -> str:
        quote = match.group(1)
        url = match.group(2).strip()
        if url.startswith("assets/"):
            return f"url({quote}../{url}{quote})"
        if url.startswith("./assets/"):
            return f"url({quote}../{url[2:]}{quote})"
        return match.group(0)

    return CSS_URL_RE.sub(adjust_asset_path, css)


def split_single_file_html(html: str) -> dict[str, str]:
    """Create a conservative HTML/CSS/JS Vite source layout.

    A single plain style or classic script can be moved in place without
    changing order. Multiple blocks, modules, import maps, JSON/template
    scripts, special style types, and attributed blocks remain inline.
    """
    soup = BeautifulSoup(html, "html.parser")
    styles = extract_safe_style(soup, "styles.css")
    scripts = extract_safe_script(soup, "script.js")
    return {
        "index.html": str(soup),
        "styles.css": styles,
        "script.js": scripts,
    }


def javascript_binding_declared(source: str, name: str) -> bool:
    declaration = re.search(
        rf"\b(?:class|const|function|let|var)\s+{re.escape(name)}\b", source
    )
    destructured = re.search(
        rf"\{{[^}}]*\b{re.escape(name)}\b[^}}]*\}}\s*=\s*React\b", source
    )
    imported = re.search(
        rf"\bimport\b[^;]*\b{re.escape(name)}\b[^;]*\bfrom\b", source
    )
    return bool(declaration or destructured or imported)


def react_named_imports(source: str) -> list[str]:
    imports: list[str] = []
    for name in REACT_NAMED_IMPORTS:
        used_as_call = re.search(rf"(?<![\w.]){re.escape(name)}\s*\(", source)
        used_as_fragment = name == "Fragment" and re.search(
            r"<\s*(?:Fragment|Fragment\s)", source
        )
        if (used_as_call or used_as_fragment) and not javascript_binding_declared(
            source, name
        ):
            imports.append(name)
    return imports


def is_react_runtime_script(tag: Tag) -> bool:
    src = (tag_attr(tag, "src") or "").lower()
    return (
        "@babel/standalone" in src
        or ("/react@" in src and "/umd/react" in src)
        or ("/react-dom@" in src and "/umd/react-dom" in src)
    )


def build_react_scaffold(html: str, stack: str = "react_tailwind") -> dict[str, str] | None:
    soup = BeautifulSoup(html, "html.parser")
    babel_scripts = [
        tag
        for tag in soup.find_all("script")
        if isinstance(tag, Tag)
        and str(tag.get("type") or "").strip().lower() == "text/babel"
        and not tag.get("src")
    ]
    if len(babel_scripts) != 1 or set(babel_scripts[0].attrs) != {"type"}:
        return None

    source = babel_scripts[0].get_text().strip()
    if not source or re.search(r"\bfrom\s*['\"](?:react|react-dom)", source):
        return None
    styles = framework_stylesheet(soup)
    if styles is None:
        return None
    if any(
        javascript_binding_declared(source, binding)
        for binding in ("React", "ReactDOM", "ReactDOMClient", "ReactDOMLegacy")
    ):
        return None

    named_imports = react_named_imports(source)
    named_clause = f", {{ {', '.join(named_imports)} }}" if named_imports else ""
    imports = [
        f'import React{named_clause} from "react";',
        'import * as ReactDOMLegacy from "react-dom";',
        'import * as ReactDOMClient from "react-dom/client";',
    ]
    if re.search(r"(?<![\w.])createRoot\s*\(", source) and not javascript_binding_declared(
        source, "createRoot"
    ):
        imports.append('import { createRoot } from "react-dom/client";')
    if re.search(r"(?<![\w.])render\s*\(", source) and not javascript_binding_declared(
        source, "render"
    ):
        imports.append('import { render } from "react-dom";')

    prelude = "\n".join(imports)
    app_source = f'''{prelude}

const ReactDOM = {{ ...ReactDOMLegacy, ...ReactDOMClient }};

{source}
'''

    babel_script = babel_scripts[0]
    module_script = soup.new_tag("script", type="module", src="/src/main.jsx")
    module_script.string = ""
    babel_script.replace_with(module_script)
    for script in list(soup.find_all("script")):
        if isinstance(script, Tag) and is_react_runtime_script(script):
            script.decompose()

    strategy = get_export_strategy(stack)
    return {
        "index.html": str(soup),
        "src/App.jsx": app_source,
        "src/main.jsx": 'import "./App.jsx";\n',
        "src/styles.css": styles,
        "package.json": build_package_json(
            stack,
            {"react": "^18.3.1", "react-dom": "^18.3.1"},
            react_plugin=True,
        ),
        "vite.config.js": build_vite_config(react_plugin=True),
        "README.md": build_project_readme(stack, strategy, "vite_react"),
    }


def preact_package_for_url(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc.lower() != "esm.sh":
        return None
    path = parsed.path.strip("/")
    if re.fullmatch(r"preact@10(?:\.\d+){0,2}", path):
        return "preact"
    if re.fullmatch(r"preact@10(?:\.\d+){0,2}/hooks", path):
        return "preact/hooks"
    if re.fullmatch(r"htm@3(?:\.\d+){0,2}", path):
        return "htm"
    return None


PREACT_IMPORT_RE = re.compile(
    r"(?P<prefix>\b(?:from|import)\s*(?:\(\s*)?)(?P<quote>['\"])(?P<url>https://esm\.sh/[^'\"]+)(?P=quote)"
)


def rewrite_preact_imports(source: str) -> tuple[str, set[str]]:
    packages: set[str] = set()

    def replace(match: re.Match[str]) -> str:
        package = preact_package_for_url(match.group("url"))
        if not package:
            return match.group(0)
        packages.add(package.split("/", 1)[0])
        return f"{match.group('prefix')}{match.group('quote')}{package}{match.group('quote')}"

    return PREACT_IMPORT_RE.sub(replace, source), packages


def build_preact_scaffold(
    html: str, stack: str = "preact_tailwind"
) -> dict[str, str] | None:
    soup = BeautifulSoup(html, "html.parser")
    module_scripts = [
        tag
        for tag in soup.find_all("script")
        if isinstance(tag, Tag)
        and str(tag.get("type") or "").strip().lower() == "module"
        and not tag.get("src")
        and "esm.sh/preact" in tag.get_text()
    ]
    if len(module_scripts) != 1 or set(module_scripts[0].attrs) != {"type"}:
        return None

    source = module_scripts[0].get_text().strip()
    if not source or "import.meta.url" in source or re.search(r"\bnew\s+URL\s*\(", source):
        return None
    styles = framework_stylesheet(soup)
    if styles is None:
        return None
    rewritten_source, packages = rewrite_preact_imports(source)
    if packages != {"preact", "htm"}:
        return None
    if re.search(
        r"\b(?:from|import)\s*(?:\(\s*)?['\"]https://esm\.sh/(?:preact|htm)",
        rewritten_source,
    ):
        return None

    module_script = module_scripts[0]
    replacement = soup.new_tag("script", type="module", src="/src/main.js")
    replacement.string = ""
    module_script.replace_with(replacement)

    strategy = get_export_strategy(stack)
    return {
        "index.html": str(soup),
        "src/main.js": f"{rewritten_source}\n",
        "src/styles.css": styles,
        "package.json": build_package_json(
            stack, {"htm": "^3.1.1", "preact": "^10.26.4"}
        ),
        "vite.config.js": build_vite_config(),
        "README.md": build_project_readme(stack, strategy, "vite_preact"),
    }


def build_project_scaffold(
    stack: str | None, fallback_reason: str | None = None
) -> dict[str, str]:
    strategy = get_export_strategy(stack)
    return {
        "package.json": build_package_json(stack, static_build=True),
        "vite.config.js": build_static_vite_config(),
        "build.mjs": build_static_copy_script(),
        "README.md": build_project_readme(
            stack, strategy, "vite_html", fallback_reason=fallback_reason
        ),
    }


def project_has_build_command(files: dict[str, str]) -> bool:
    package_json = next(
        (
            content
            for path, content in files.items()
            if path == "package.json"
        ),
        None,
    )
    if package_json is None:
        return False

    try:
        package_value: object = json.loads(package_json)
    except json.JSONDecodeError:
        return False
    if not isinstance(package_value, dict):
        return False
    package = cast(dict[str, object], package_value)

    scripts_value = package.get("scripts")
    if not isinstance(scripts_value, dict):
        return False
    scripts = cast(dict[str, object], scripts_value)
    build_command = scripts.get("build")
    return isinstance(build_command, str) and bool(build_command.strip())


def source_project_notice_path(files: dict[str, str]) -> str:
    used_paths = {path.casefold() for path in files}
    for candidate in ("README.md", "SHOT2CODE_EXPORT.md"):
        if candidate.casefold() not in used_paths:
            return candidate

    index = 2
    while f"SHOT2CODE_EXPORT-{index}.md".casefold() in used_paths:
        index += 1
    return f"SHOT2CODE_EXPORT-{index}.md"


def build_source_project_export(
    project: NormalizedProjectPayload, stack: str | None
) -> ProjectExport:
    files = dict(project.files)
    if project_has_build_command(files):
        return ProjectExport(files, "source_project")

    notice_path = source_project_notice_path(files)
    stack_name = (stack or "unspecified").replace("`", "")
    files[notice_path] = f'''# shot2code source export

All supplied project files were preserved, including the declared entry point
`{project.entry_point}`. The separate HTML preview was not substituted for the
source tree.

## Safe fallback

No package or framework scaffold was generated because the supplied project did
not contain a valid root `package.json` with a non-empty `build` script. Adding
one would risk producing a plausible-looking project that does not match the
source dependencies or original toolchain. Restore the project's own build
configuration before running it.

Detected shot2code stack: `{stack_name}`.
'''
    return ProjectExport(files, "source_project_fallback")


def is_legacy_single_html_payload(project: NormalizedProjectPayload) -> bool:
    return (
        len(project.files) == 1
        and project.entry_point.casefold() == "index.html"
        and PurePosixPath(project.entry_point).suffix.casefold() in {".htm", ".html"}
    )


def build_project_export(html: str, stack: str | None) -> ProjectExport:
    strategy = get_export_strategy(stack)
    if strategy.project_kind == "vite_react":
        react_files = build_react_scaffold(html, stack or "react_tailwind")
        if react_files is not None:
            return ProjectExport(react_files, "vite_react")
        fallback_reason = (
            "React source lifting requires exactly one standard inline `text/babel` block "
            "without conflicting React bindings."
        )
    elif strategy.project_kind == "vite_preact":
        preact_files = build_preact_scaffold(html, stack or "preact_tailwind")
        if preact_files is not None:
            return ProjectExport(preact_files, "vite_preact")
        fallback_reason = (
            "Preact source lifting requires one standard inline module using the canonical "
            "esm.sh Preact and HTM imports."
        )
    else:
        fallback_reason = None

    files = split_single_file_html(html)
    files.update(build_project_scaffold(stack, fallback_reason=fallback_reason))
    return ProjectExport(files, "vite_html")


@router.post("/api/export")
async def export_code(request: ExportRequest) -> Response:
    normalized_project = (
        normalize_project_payload(request.project)
        if request.splitFiles and request.project is not None
        else None
    )

    if normalized_project is not None and not is_legacy_single_html_payload(
        normalized_project
    ):
        candidates = collect_project_asset_candidates(normalized_project.files)
        assets, asset_path_by_url = await download_assets(
            candidates,
            request.baseUrl,
            reserved_paths=normalized_project.files,
        )
        rewritten_project = NormalizedProjectPayload(
            entry_point=normalized_project.entry_point,
            files=rewrite_project_asset_urls(
                normalized_project.files, asset_path_by_url
            ),
        )
        project_export = build_source_project_export(
            rewritten_project, request.stack
        )
        zip_content = create_project_zip("", assets, project_export.files)
        project_kind = project_export.project_kind
    else:
        html_source = (
            normalized_project.files[normalized_project.entry_point]
            if normalized_project is not None
            else request.code
        )
        soup = BeautifulSoup(normalize_babel_cdn(html_source), "html.parser")
        candidates = collect_asset_candidates(soup)
        assets, asset_path_by_url = await download_assets(
            candidates, request.baseUrl
        )

        if asset_path_by_url:
            rewrite_html_assets(soup, asset_path_by_url)
        index_html = rewrite_raw_asset_urls(str(soup), asset_path_by_url)

        project_kind = "single_html"
        extra_files: dict[str, str] | None = None
        if request.splitFiles:
            project_export = build_project_export(index_html, request.stack)
            extra_files = project_export.files
            project_kind = project_export.project_kind

        zip_content = create_project_zip(index_html, assets, extra_files)

    filename = export_archive_filename(request.stack, request.splitFiles)
    print(
        "Export complete: "
        f"candidates={len(candidates)} assets={len(assets)} "
        f"skipped={len(candidates) - len(assets)} mode={project_kind} "
        f"responseBytes={len(zip_content)}"
    )
    return Response(
        content=zip_content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
