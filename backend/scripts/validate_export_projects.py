"""Install and build every generated export plus real framework payloads."""

import argparse
import asyncio
from dataclasses import dataclass
from io import BytesIO
import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import gettempdir, TemporaryDirectory
from typing import cast
from zipfile import ZipFile

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from routes.export import (  # noqa: E402
    EXPORT_STRATEGIES,
    ExportProjectPayload,
    ExportRequest,
    export_code,
)
from tests.export_stack_fixtures import (  # noqa: E402
    PROJECT_PAYLOAD_FIXTURES,
    STACK_FIXTURES,
)


@dataclass(frozen=True)
class ValidationProject:
    label: str
    stack: str
    directory: Path
    workspace_name: str
    source_payload: bool


def npm_executable() -> str:
    executable = shutil.which("npm.cmd") or shutil.which("npm")
    if executable is None:
        raise RuntimeError("npm is required to validate exported projects")
    return executable


async def write_project(
    stack: str,
    destination: Path,
    project: ExportProjectPayload | None = None,
) -> set[str]:
    response = await export_code(
        ExportRequest(
            code=(
                "<!doctype html><p>preview-only fallback</p>"
                if project is not None
                else STACK_FIXTURES[stack]
            ),
            stack=stack,
            splitFiles=True,
            project=project,
        )
    )
    with ZipFile(BytesIO(response.body)) as archive:
        names = set(archive.namelist())
        archive.extractall(destination)
    return names


def workspace_name(project_dir: Path) -> str:
    package_value: object = json.loads(
        (project_dir / "package.json").read_text(encoding="utf-8")
    )
    if not isinstance(package_value, dict):
        raise RuntimeError(f"{project_dir.name} package.json is not an object")
    package = cast(dict[str, object], package_value)
    name = package.get("name")
    if not isinstance(name, str) or not name:
        raise RuntimeError(f"{project_dir.name} package.json has no package name")
    return name


def install_workspaces(root: Path, projects: list[ValidationProject], npm: str) -> None:
    workspace_paths = [project.directory.name for project in projects]
    package: dict[str, object] = {
        "name": "shot2code-export-validation",
        "private": True,
        "workspaces": workspace_paths,
    }
    (root / "package.json").write_text(
        json.dumps(package, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"\n=== installing {len(projects)} export workspaces ===",
        flush=True,
    )
    subprocess.run(
        [npm, "install", "--no-audit", "--no-fund", "--prefer-offline"],
        cwd=root,
        check=True,
    )


def run_build(project: ValidationProject, root: Path, npm: str) -> Path:
    print(f"\n=== {project.label}: npm run build ===", flush=True)
    subprocess.run(
        [npm, "run", "build", "--workspace", project.workspace_name],
        cwd=root,
        check=True,
    )

    dist = project.directory / "dist"
    if not (dist / "index.html").is_file():
        raise RuntimeError(f"{project.label} build is missing dist/index.html")
    return dist


def validate_generated_build(project: ValidationProject, dist: Path) -> None:
    required = [dist / "assets" / "image-1.png"]
    if EXPORT_STRATEGIES[project.stack].project_kind == "vite_html":
        required.append(dist / "script.js")
    missing = [
        str(path.relative_to(project.directory))
        for path in required
        if not path.is_file()
    ]
    if missing:
        raise RuntimeError(
            f"{project.label} build is missing: {', '.join(missing)}"
        )


def validate_source_build(project: ValidationProject, dist: Path) -> None:
    built_scripts = list((dist / "assets").glob("*.js"))
    if not built_scripts:
        raise RuntimeError(
            f"{project.label} build produced no JavaScript bundle"
        )


async def prepare_projects(root: Path, stacks: list[str]) -> list[ValidationProject]:
    projects: list[ValidationProject] = []
    for stack in stacks:
        project_dir = root / f"generated-{stack}"
        project_dir.mkdir()
        await write_project(stack, project_dir)
        projects.append(
            ValidationProject(
                label=stack,
                stack=stack,
                directory=project_dir,
                workspace_name=workspace_name(project_dir),
                source_payload=False,
            )
        )

        payload_fixture = PROJECT_PAYLOAD_FIXTURES.get(stack)
        if payload_fixture is None:
            continue

        source_project = ExportProjectPayload.model_validate(payload_fixture)
        source_dir = root / f"source-{stack}"
        source_dir.mkdir()
        archive_paths = await write_project(stack, source_dir, source_project)
        expected_paths = {file.path for file in source_project.files}
        if archive_paths != expected_paths:
            missing = sorted(expected_paths - archive_paths)
            unexpected = sorted(archive_paths - expected_paths)
            raise RuntimeError(
                f"{stack} source payload changed files; "
                f"missing={missing}, unexpected={unexpected}"
            )
        projects.append(
            ValidationProject(
                label=f"{stack} source payload",
                stack=stack,
                directory=source_dir,
                workspace_name=workspace_name(source_dir),
                source_payload=True,
            )
        )

    return projects


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--stack",
        action="append",
        choices=tuple(EXPORT_STRATEGIES),
        help="Validate only this stack; repeat to select several.",
    )
    args = parser.parse_args()
    stacks = args.stack or list(EXPORT_STRATEGIES)
    npm = npm_executable()

    temporary_parent = Path(gettempdir()).resolve()
    with TemporaryDirectory(
        prefix="shot2code-export-builds-", dir=temporary_parent
    ) as temp:
        root = Path(temp)
        projects = await prepare_projects(root, stacks)
        install_workspaces(root, projects, npm)
        for project in projects:
            dist = run_build(project, root, npm)
            if project.source_payload:
                validate_source_build(project, dist)
            else:
                validate_generated_build(project, dist)

    print(f"\nValidated {len(projects)} export project(s).")


if __name__ == "__main__":
    asyncio.run(main())
