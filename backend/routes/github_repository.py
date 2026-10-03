"""Safely inspect a GitHub repository as an editable, never-executed project."""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import PurePosixPath
from typing import Literal
from urllib.parse import quote, urlsplit
from zipfile import ZipFile

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from image_generation.assets import persist_image_bytes
from routes.project_context import (
    MAX_ARCHIVE_BYTES,
    ProjectInspectionResponse,
    SKIPPED_PARTS,
    _decode_zip_project,
    _strip_wrapper_root,
    build_project_inspection,
)

router = APIRouter()
MAX_REPOSITORY_ASSETS = 40
MAX_REPOSITORY_ASSET_BYTES = 8 * 1024 * 1024
MAX_REPOSITORY_ASSET_TOTAL_BYTES = 20 * 1024 * 1024
REPOSITORY_ASSET_MIME = {
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


class GitHubRepositoryInspectRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    token: str | None = Field(default=None, max_length=512)


class GitHubRepositoryAsset(BaseModel):
    path: str
    content: str
    mimeType: str
    size: int
    encoding: Literal["base64"] = "base64"
    sourceUrl: str
    kind: Literal["repository image"] = "repository image"


class GitHubRepositoryInspectionResponse(ProjectInspectionResponse):
    assets: list[GitHubRepositoryAsset]
    sourceAssets: list[dict[str, str]]
    warnings: list[str]


def parse_github_repository_url(url: str) -> tuple[str, str, str | None]:
    parts = urlsplit(url.strip())
    if parts.scheme != "https" or parts.hostname not in {"github.com", "www.github.com"}:
        raise ValueError("Use an https://github.com/<owner>/<repository> URL.")
    segments = [segment for segment in parts.path.split("/") if segment]
    if len(segments) < 2:
        raise ValueError("The GitHub URL does not identify a repository.")
    owner, repository = segments[:2]
    if repository.endswith(".git"):
        repository = repository[:-4]
    ref = None
    if len(segments) >= 4 and segments[2] == "tree":
        ref = segments[3]
    if not owner or not repository:
        raise ValueError("The GitHub URL does not identify a repository.")
    return owner, repository, ref


async def _download_repository_zip(
    owner: str,
    repository: str,
    ref: str | None,
    token: str | None,
) -> bytes:
    suffix = f"/{quote(ref, safe='')}" if ref else ""
    api_url = (
        f"https://api.github.com/repos/{quote(owner)}/{quote(repository)}"
        f"/zipball{suffix}"
    )
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "shot2code",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
        response = await client.get(api_url, headers=headers)
        if response.status_code in {401, 403}:
            raise PermissionError(
                "GitHub refused repository access. For a private repository, "
                "use a fine-grained token limited to that repository with "
                "Contents: read."
            )
        if response.status_code == 404:
            raise FileNotFoundError(
                "The repository or branch was not found, or the supplied token "
                "cannot read it."
            )
        if response.status_code not in {301, 302, 303, 307, 308}:
            response.raise_for_status()
            content = response.content
        else:
            location = str(response.headers.get("location", ""))
            redirect = urlsplit(location)
            if redirect.scheme != "https" or redirect.hostname != "codeload.github.com":
                raise ValueError("GitHub returned an unexpected archive location.")
            async with client.stream(
                "GET",
                location,
                headers={"User-Agent": "shot2code"},
            ) as archive_response:
                archive_response.raise_for_status()
                declared = int(archive_response.headers.get("content-length") or "0")
                if declared > MAX_ARCHIVE_BYTES:
                    raise ValueError("The repository archive exceeds the 30 MB limit.")
                body = bytearray()
                async for chunk in archive_response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_ARCHIVE_BYTES:
                        raise ValueError(
                            "The repository archive exceeds the 30 MB limit."
                        )
                content = bytes(body)
    if len(content) > MAX_ARCHIVE_BYTES:
        raise ValueError("The repository archive exceeds the 30 MB limit.")
    return content


async def _repository_assets(
    payload: bytes,
    *,
    wrapper_root: str | None,
    owner: str,
    repository: str,
    ref: str | None,
    asset_base_url: str,
) -> tuple[list[GitHubRepositoryAsset], list[dict[str, str]], list[str]]:
    assets: list[GitHubRepositoryAsset] = []
    source_assets: list[dict[str, str]] = []
    warnings: list[str] = []
    total_bytes = 0
    with ZipFile(BytesIO(payload)) as archive:
        for entry in archive.infolist():
            if entry.is_dir() or len(assets) >= MAX_REPOSITORY_ASSETS:
                continue
            raw_path = entry.filename.replace("\\", "/").lstrip("/")
            if wrapper_root and raw_path.startswith(f"{wrapper_root}/"):
                raw_path = raw_path[len(wrapper_root) + 1 :]
            path = PurePosixPath(raw_path)
            if (
                path.is_absolute()
                or ".." in path.parts
                or any(part.lower() in SKIPPED_PARTS for part in path.parts)
            ):
                continue
            mime_type = REPOSITORY_ASSET_MIME.get(path.suffix.lower())
            if mime_type is None:
                continue
            if entry.file_size <= 0 or entry.file_size > MAX_REPOSITORY_ASSET_BYTES:
                warnings.append(f"{raw_path} was skipped because it is empty or over 8 MB.")
                continue
            data = archive.read(entry)
            if total_bytes + len(data) > MAX_REPOSITORY_ASSET_TOTAL_BYTES:
                warnings.append(
                    "Additional repository images were skipped after the 20 MB "
                    "asset limit was reached."
                )
                break
            normalized = await persist_image_bytes(
                data,
                asset_base_url=asset_base_url,
                provider="github",
                mime_hint=mime_type,
            )
            total_bytes += len(data)
            source_url = (
                f"https://github.com/{quote(owner)}/{quote(repository)}/blob/"
                f"{quote(ref or 'HEAD', safe='')}/{quote(raw_path, safe='/')}"
            )
            assets.append(
                GitHubRepositoryAsset(
                    path=raw_path,
                    content=base64.b64encode(data).decode("ascii"),
                    mimeType=normalized.mime_type,
                    size=len(data),
                    sourceUrl=source_url,
                )
            )
            source_assets.append(
                {
                    "name": raw_path,
                    "url": normalized.url,
                    "mimeType": normalized.mime_type,
                    "source": "github",
                    "kind": "repository image",
                }
            )
    return assets, source_assets, warnings


@router.post(
    "/api/github-repository/inspect",
    response_model=GitHubRepositoryInspectionResponse,
)
async def inspect_github_repository(
    request: GitHubRepositoryInspectRequest,
    http_request: Request,
) -> GitHubRepositoryInspectionResponse:
    try:
        owner, repository, ref = parse_github_repository_url(request.url)
        payload = await _download_repository_zip(
            owner,
            repository,
            ref,
            (request.token or "").strip() or None,
        )
        decoded = _decode_zip_project(payload)
        files, wrapper_root = _strip_wrapper_root(decoded.files, "zip")
        assets, source_assets, warnings = await _repository_assets(
            payload,
            wrapper_root=wrapper_root,
            owner=owner,
            repository=repository,
            ref=ref,
            asset_base_url=str(http_request.base_url).rstrip("/"),
        )
        inspection = build_project_inspection(
            name=repository,
            files=files,
            original_file_count=decoded.original_file_count,
            source_kind="zip",
            ignored_file_count=max(0, decoded.ignored_file_count - len(assets)),
        )
        return GitHubRepositoryInspectionResponse(
            context=inspection.context,
            project=inspection.project,
            assets=assets,
            sourceAssets=source_assets,
            warnings=warnings,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except httpx.TimeoutException as error:
        raise HTTPException(
            status_code=504,
            detail="GitHub did not return the repository archive before timeout.",
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail="The GitHub repository could not be downloaded.",
        ) from error
