import json
from io import BytesIO
from pathlib import PurePosixPath
from zipfile import ZipFile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from prompts.prompt_types import Stack
from routes.export import EXPORT_STRATEGIES, ExportProjectPayload, ExportRequest, export_code
from routes.project_context import router
from tests.export_stack_fixtures import (
    PROJECT_KINDS,
    PROJECT_PAYLOAD_FIXTURES,
    STACK_FIXTURES,
)
from tests.stack_acceptance_fixtures import (
    STACK_ACCEPTANCE_CASES,
    StackAcceptanceCase,
)
from typing import TypedDict, cast, get_args


class ImportedSourceFile(TypedDict):
    path: str


class ImportedProject(TypedDict):
    detected_stack: str | None
    entry_path: str | None
    files: list[ImportedSourceFile]


SUPPORTED_SOURCE_SUFFIXES = {
    ".cjs",
    ".css",
    ".cts",
    ".html",
    ".htm",
    ".js",
    ".jsx",
    ".json",
    ".less",
    ".md",
    ".mjs",
    ".mts",
    ".scss",
    ".ts",
    ".tsx",
    ".vue",
    ".yaml",
    ".yml",
}


def archive_files(payload: bytes | memoryview) -> dict[str, bytes]:
    with ZipFile(BytesIO(bytes(payload))) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


@pytest.fixture(scope="module")
def project_context_client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def inspect_archive(client: TestClient, payload: bytes | memoryview) -> ImportedProject:
    response = client.post(
        "/api/project-context/inspect-zip",
        content=bytes(payload),
        headers={"Content-Type": "application/zip"},
    )
    assert response.status_code == 200, response.text
    return cast(ImportedProject, response.json()["project"])


def expected_imported_source_paths(paths: set[str]) -> set[str]:
    return {
        path
        for path in paths
        if PurePosixPath(path).suffix.casefold() in SUPPORTED_SOURCE_SUFFIXES
    }


def test_acceptance_matrix_covers_exactly_the_12_supported_stacks() -> None:
    matrix_stacks = tuple(case.stack for case in STACK_ACCEPTANCE_CASES)

    assert matrix_stacks == tuple(STACK_FIXTURES)
    assert matrix_stacks == tuple(EXPORT_STRATEGIES)
    assert set(matrix_stacks) == set(get_args(Stack))
    assert set(matrix_stacks) == set(PROJECT_KINDS)


@pytest.mark.parametrize("acceptance", STACK_ACCEPTANCE_CASES, ids=lambda case: case.stack)
@pytest.mark.asyncio
async def test_single_html_export_reimports_as_the_same_stack(
    acceptance: StackAcceptanceCase,
    project_context_client: TestClient,
) -> None:
    response = await export_code(
        ExportRequest(code=STACK_FIXTURES[acceptance.stack], stack=acceptance.stack)
    )
    files = archive_files(response.body)
    project = inspect_archive(project_context_client, response.body)

    assert set(files) == {"index.html", "assets/image-1.png"}
    assert project["detected_stack"] == acceptance.stack
    assert project["entry_path"] == "index.html"
    assert [file["path"] for file in project["files"]] == ["index.html"]


@pytest.mark.parametrize("acceptance", STACK_ACCEPTANCE_CASES, ids=lambda case: case.stack)
@pytest.mark.asyncio
async def test_project_export_reimports_with_full_source_and_build_contract(
    acceptance: StackAcceptanceCase,
    project_context_client: TestClient,
) -> None:
    response = await export_code(
        ExportRequest(
            code=STACK_FIXTURES[acceptance.stack],
            stack=acceptance.stack,
            splitFiles=True,
        )
    )
    files = archive_files(response.body)
    project = inspect_archive(project_context_client, response.body)
    package = json.loads(files["package.json"].decode("utf-8"))

    assert project["detected_stack"] == acceptance.stack
    assert {file["path"] for file in project["files"]} == expected_imported_source_paths(
        set(files)
    )
    assert project["entry_path"] in {file["path"] for file in project["files"]}
    assert package["scripts"]["build"] == (
        "node build.mjs"
        if PROJECT_KINDS[acceptance.stack] == "vite_html"
        else "vite build"
    )
    assert "npm run build" in files["README.md"].decode("utf-8")


@pytest.mark.parametrize("stack", tuple(PROJECT_PAYLOAD_FIXTURES))
@pytest.mark.asyncio
async def test_preserved_compiled_project_reimports_without_losing_files(
    stack: str,
    project_context_client: TestClient,
) -> None:
    payload = ExportProjectPayload.model_validate(PROJECT_PAYLOAD_FIXTURES[stack])
    response = await export_code(
        ExportRequest(
            code="<!doctype html><p>preview fallback</p>",
            stack=stack,
            splitFiles=True,
            project=payload,
        )
    )
    project = inspect_archive(project_context_client, response.body)

    assert project["detected_stack"] == stack
    assert {file["path"] for file in project["files"]} == {
        file.path for file in payload.files
    }
