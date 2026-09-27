"""Import and manage reviewed Agent Skills stored on this device."""

from __future__ import annotations

import base64
from typing import Any, cast
from urllib.parse import quote, urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from skills.store import (
    MAX_SKILL_FILES,
    MAX_SKILL_FILE_BYTES,
    SkillFile,
    SkillImportError,
    SkillSummary,
    install_skill,
    list_skills,
    remove_skill,
    set_skill_enabled,
)

router = APIRouter()


class SkillFileInput(BaseModel):
    path: str
    content: str


class SkillImportRequest(BaseModel):
    files: list[SkillFileInput] = Field(max_length=MAX_SKILL_FILES)
    source: str = "local"


class GitHubSkillImportRequest(BaseModel):
    url: str


class SkillEnabledRequest(BaseModel):
    enabled: bool


def _summary(skill: SkillSummary) -> dict[str, object]:
    return skill.to_dict()


@router.get("/api/skills")
async def get_skills() -> dict[str, Any]:
    return {"skills": [_summary(skill) for skill in list_skills()]}


@router.post("/api/skills/import")
async def import_skill(request: SkillImportRequest) -> dict[str, Any]:
    try:
        summary = install_skill(
            (
                SkillFile(path=file.path, content=file.content)
                for file in request.files
            ),
            source=request.source,
        )
    except SkillImportError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"skill": _summary(summary)}


def _parse_github_tree_url(url: str) -> tuple[str, str, str, str]:
    parts = urlsplit(url.strip())
    if parts.scheme != "https" or parts.hostname != "github.com":
        raise SkillImportError(
            "Use an https://github.com/<owner>/<repo>/tree/<ref>/<skill> URL."
        )
    segments = [segment for segment in parts.path.split("/") if segment]
    if len(segments) < 5 or segments[2] != "tree":
        raise SkillImportError(
            "Paste the GitHub URL of a skill folder, including /tree/<ref>/."
        )
    owner, repo, _tree, ref, *skill_path = segments
    return owner, repo, ref, "/".join(skill_path)


async def _read_github_directory(
    client: httpx.AsyncClient,
    owner: str,
    repo: str,
    ref: str,
    path: str,
    root_path: str,
    files: list[SkillFile],
) -> None:
    if len(files) >= MAX_SKILL_FILES:
        raise SkillImportError(f"A skill may contain at most {MAX_SKILL_FILES} files.")
    endpoint = (
        f"https://api.github.com/repos/{quote(owner)}/{quote(repo)}/contents/"
        f"{quote(path, safe='/')}"
    )
    response = await client.get(
        endpoint,
        params={"ref": ref},
        headers={
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    if response.status_code == 404:
        raise SkillImportError("The public GitHub skill folder was not found.")
    if response.status_code == 403:
        raise SkillImportError(
            "GitHub refused the unauthenticated import or its rate limit was reached."
        )
    response.raise_for_status()
    payload = cast(object, response.json())
    entries = cast(list[object], payload) if isinstance(payload, list) else [payload]
    for raw_entry in entries:
        if not isinstance(raw_entry, dict):
            continue
        entry = cast(dict[str, object], raw_entry)
        kind = entry.get("type")
        entry_path = entry.get("path")
        if not isinstance(entry_path, str):
            continue
        if kind == "dir":
            await _read_github_directory(
                client,
                owner,
                repo,
                ref,
                entry_path,
                root_path,
                files,
            )
            continue
        if kind != "file":
            continue
        if len(files) >= MAX_SKILL_FILES:
            raise SkillImportError(
                f"A skill may contain at most {MAX_SKILL_FILES} files."
            )
        size = entry.get("size")
        if isinstance(size, int) and size > MAX_SKILL_FILE_BYTES:
            raise SkillImportError(
                f"'{entry_path}' exceeds the {MAX_SKILL_FILE_BYTES}-byte limit."
            )
        file_response = await client.get(
            (
                f"https://api.github.com/repos/{quote(owner)}/{quote(repo)}"
                f"/contents/{quote(entry_path, safe='/')}"
            ),
            params={"ref": ref},
            headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        if file_response.status_code == 404:
            raise SkillImportError(f"'{entry_path}' disappeared during import.")
        if file_response.status_code == 403:
            raise SkillImportError(
                "GitHub refused the unauthenticated import or its rate limit was reached."
            )
        file_response.raise_for_status()
        file_payload = cast(object, file_response.json())
        if not isinstance(file_payload, dict):
            continue
        file_record = cast(dict[str, object], file_payload)
        content = file_record.get("content")
        encoding = file_record.get("encoding")
        if not isinstance(content, str) or encoding != "base64":
            continue
        try:
            decoded = base64.b64decode(content, validate=False).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise SkillImportError(
                f"'{entry_path}' is not a UTF-8 text skill resource."
            ) from exc
        relative = entry_path.removeprefix(root_path).lstrip("/")
        files.append(SkillFile(path=relative, content=decoded))


@router.post("/api/skills/import-github")
async def import_github_skill(
    request: GitHubSkillImportRequest,
) -> dict[str, Any]:
    try:
        owner, repo, ref, path = _parse_github_tree_url(request.url)
        files: list[SkillFile] = []
        async with httpx.AsyncClient(timeout=20) as client:
            await _read_github_directory(
                client,
                owner,
                repo,
                ref,
                path,
                path,
                files,
            )
        summary = install_skill(files, source=request.url.strip())
    except SkillImportError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail="The public GitHub skill could not be downloaded.",
        ) from error
    return {"skill": _summary(summary)}


@router.patch("/api/skills/{name}")
async def update_skill(
    name: str,
    request: SkillEnabledRequest,
) -> dict[str, Any]:
    try:
        summary = set_skill_enabled(name, request.enabled)
    except SkillImportError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"skill": _summary(summary)}


@router.delete(
    "/api/skills/{name}",
    status_code=204,
    response_class=Response,
    response_model=None,
)
async def delete_skill(name: str):
    try:
        remove_skill(name)
    except SkillImportError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return Response(status_code=204)
