import json
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath
from typing import cast
from urllib.parse import unquote
from zipfile import BadZipFile, ZipFile

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel


router = APIRouter()

MAX_ARCHIVE_BYTES = 30 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 5_000
MAX_FILES = 400
MAX_FILE_CHARS = 150_000
MAX_TOTAL_CHARS = 2_500_000
MAX_COMPONENTS = 60
MAX_TOKENS = 60
MAX_DEPENDENCIES = 80

TEXT_EXTENSIONS = {
    ".css",
    ".html",
    ".htm",
    ".js",
    ".jsx",
    ".json",
    ".less",
    ".md",
    ".mjs",
    ".scss",
    ".ts",
    ".tsx",
    ".vue",
    ".yaml",
    ".yml",
}

SKIPPED_PARTS = {
    ".git",
    ".next",
    ".nuxt",
    ".output",
    ".svelte-kit",
    ".venv",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
    "vendor",
}

COMPONENT_EXPORT_RE = re.compile(
    r"""
    export\s+
    (?:
        default\s+
    )?
    (?:
        async\s+
    )?
    (?:
        function|class|const|let
    )
    \s+
    (?P<name>[A-Z][A-Za-z0-9_]*)
    """,
    re.VERBOSE,
)
CSS_VARIABLE_RE = re.compile(r"(?P<name>--[A-Za-z0-9_-]+)\s*:\s*(?P<value>[^;{}\n]+)")
CSS_CLASS_RE = re.compile(r"(?<![A-Za-z0-9_-])\.(?P<name>[A-Za-z][A-Za-z0-9_-]{2,})")
PROPS_BLOCK_RE = re.compile(
    r"(?:interface|type)\s+(?P<name>[A-Z][A-Za-z0-9_]*Props)\s*(?:=)?\s*\{(?P<body>.*?)\}",
    re.DOTALL,
)
PROP_NAME_RE = re.compile(r"^\s*(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\??\s*:", re.MULTILINE)
class ProjectFile(BaseModel):
    path: str
    content: str


class ScanFilesRequest(BaseModel):
    name: str | None = None
    files: list[ProjectFile]


class ComponentSummary(BaseModel):
    name: str
    path: str
    props: list[str] = []


class ProjectContextResponse(BaseModel):
    name: str
    file_count: int
    analyzed_file_count: int
    component_count: int
    components: list[ComponentSummary]
    dependencies: list[str]
    tokens: list[str]
    framework_hints: list[str]
    summary: str


@dataclass(frozen=True)
class ScannableFile:
    path: str
    content: str


def normalize_project_path(raw_path: str) -> str | None:
    normalized = raw_path.replace("\\", "/").lstrip("/")
    path = PurePosixPath(normalized)
    if not normalized or ".." in path.parts:
        return None
    if any(part.lower() in SKIPPED_PARTS for part in path.parts):
        return None
    if path.suffix.lower() not in TEXT_EXTENSIONS:
        return None
    return str(path)


def collect_files(raw_files: list[ProjectFile]) -> list[ScannableFile]:
    if len(raw_files) > MAX_FILES:
        raise HTTPException(
            status_code=413,
            detail=f"Project contains too many files; limit is {MAX_FILES}.",
        )

    files: list[ScannableFile] = []
    total_chars = 0
    for raw_file in raw_files:
        path = normalize_project_path(raw_file.path)
        if path is None:
            continue

        content = raw_file.content[:MAX_FILE_CHARS]
        total_chars += len(content)
        if total_chars > MAX_TOTAL_CHARS:
            raise HTTPException(
                status_code=413,
                detail="Project source is too large to analyse safely.",
            )
        files.append(ScannableFile(path=path, content=content))
    return files


def decode_zip_files(payload: bytes) -> tuple[str, list[ScannableFile]]:
    if len(payload) > MAX_ARCHIVE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"ZIP is too large; limit is {MAX_ARCHIVE_BYTES // (1024 * 1024)} MB.",
        )

    try:
        archive = ZipFile(BytesIO(payload))
    except BadZipFile as exc:
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid ZIP.") from exc

    files: list[ScannableFile] = []
    total_chars = 0
    entries = [entry for entry in archive.infolist() if not entry.is_dir()]
    if len(entries) > MAX_ARCHIVE_ENTRIES:
        raise HTTPException(
            status_code=413,
            detail=f"ZIP contains too many entries; limit is {MAX_ARCHIVE_ENTRIES}.",
        )

    for entry in entries:
        path = normalize_project_path(entry.filename)
        if path is None:
            continue
        if len(files) >= MAX_FILES:
            raise HTTPException(
                status_code=413,
                detail=f"ZIP contains more than {MAX_FILES} supported source files.",
            )
        if entry.file_size > MAX_FILE_CHARS * 4:
            continue

        try:
            raw = archive.read(entry)
            content = raw.decode("utf-8")
        except (UnicodeDecodeError, RuntimeError):
            continue

        content = content[:MAX_FILE_CHARS]
        total_chars += len(content)
        if total_chars > MAX_TOTAL_CHARS:
            raise HTTPException(
                status_code=413,
                detail="ZIP source is too large to analyse safely.",
            )
        files.append(ScannableFile(path=path, content=content))

    roots = {
        PurePosixPath(entry.filename.replace("\\", "/")).parts[0]
        for entry in entries
        if PurePosixPath(entry.filename.replace("\\", "/")).parts
    }
    project_name = next(iter(roots)) if len(roots) == 1 else "Imported project"
    return project_name, files


def component_props(content: str, component_name: str) -> list[str]:
    props: list[str] = []
    for match in PROPS_BLOCK_RE.finditer(content):
        if match.group("name") != f"{component_name}Props":
            continue
        props.extend(
            prop.group("name") for prop in PROP_NAME_RE.finditer(match.group("body"))
        )

    destructured_re = re.compile(
        rf"(?:function\s+{re.escape(component_name)}|"
        rf"const\s+{re.escape(component_name)}\s*=\s*)"
        r"\s*\(\s*\{(?P<body>[^}]*)\}",
        re.DOTALL,
    )
    for match in destructured_re.finditer(content):
        for candidate in match.group("body").split(","):
            name = candidate.strip().split(":", 1)[0].split("=", 1)[0].strip()
            if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name):
                props.append(name)
    return list(dict.fromkeys(props))[:12]


def discover_components(files: list[ScannableFile]) -> list[ComponentSummary]:
    components: list[ComponentSummary] = []
    for file in files:
        suffix = PurePosixPath(file.path).suffix.lower()
        if suffix == ".vue":
            name = PurePosixPath(file.path).stem
            if name and name[0].isupper():
                components.append(ComponentSummary(name=name, path=file.path))
            continue
        if suffix not in {".js", ".jsx", ".ts", ".tsx"}:
            continue

        for match in COMPONENT_EXPORT_RE.finditer(file.content):
            name = match.group("name")
            components.append(
                ComponentSummary(
                    name=name,
                    path=file.path,
                    props=component_props(file.content, name),
                )
            )
            if len(components) >= MAX_COMPONENTS:
                return components
    return components


def discover_dependencies(files: list[ScannableFile]) -> list[str]:
    dependencies: list[str] = []
    for file in files:
        if PurePosixPath(file.path).name != "package.json":
            continue
        try:
            package = json.loads(file.content)
        except json.JSONDecodeError:
            continue
        if not isinstance(package, dict):
            continue
        package_values = cast(dict[str, object], package)
        for section in ("dependencies", "devDependencies"):
            values = package_values.get(section)
            if isinstance(values, dict):
                dependencies.extend(
                    str(name) for name in cast(dict[str, object], values)
                )
    return sorted(set(dependencies))[:MAX_DEPENDENCIES]


def discover_framework_hints(dependencies: list[str], files: list[ScannableFile]) -> list[str]:
    hints: list[str] = []
    dependency_set = set(dependencies)
    has_tailwind_config = any(
        PurePosixPath(file.path).name.lower().startswith("tailwind.config.")
        for file in files
    )
    checks = [
        ("Next.js", "next" in dependency_set),
        ("React", "react" in dependency_set),
        ("Vue", "vue" in dependency_set),
        ("Svelte", "svelte" in dependency_set),
        ("Angular", "@angular/core" in dependency_set),
        ("Tailwind CSS", "tailwindcss" in dependency_set or has_tailwind_config),
        ("Material UI", "@mui/material" in dependency_set),
        ("Chakra UI", "@chakra-ui/react" in dependency_set),
        ("shadcn/ui", any("/components/ui/" in f"/{file.path.lower()}" for file in files)),
    ]
    for label, present in checks:
        if present:
            hints.append(label)
    return hints


def discover_tokens(files: list[ScannableFile]) -> list[str]:
    tokens: list[str] = []
    for file in files:
        suffix = PurePosixPath(file.path).suffix.lower()
        if suffix not in {".css", ".less", ".scss", ".html", ".vue"}:
            continue
        for match in CSS_VARIABLE_RE.finditer(file.content):
            tokens.append(f"{match.group('name')}: {match.group('value').strip()}")
            if len(tokens) >= MAX_TOKENS:
                return list(dict.fromkeys(tokens))

    for file in files:
        suffix = PurePosixPath(file.path).suffix.lower()
        if suffix not in {".css", ".less", ".scss"}:
            continue
        for match in CSS_CLASS_RE.finditer(file.content):
            tokens.append(f".{match.group('name')}")
            if len(tokens) >= MAX_TOKENS:
                return list(dict.fromkeys(tokens))
    return list(dict.fromkeys(tokens))


def build_summary(
    name: str,
    files: list[ScannableFile],
    components: list[ComponentSummary],
    dependencies: list[str],
    tokens: list[str],
    framework_hints: list[str],
) -> str:
    lines = [
        "## Imported codebase context",
        "",
        f"Project: {name}",
        f"Analysed source files: {len(files)}",
    ]
    if framework_hints:
        lines.append(f"Frameworks and UI libraries: {', '.join(framework_hints)}")
    if dependencies:
        lines.extend(["", "Dependencies:", f"- {', '.join(dependencies)}"])
    if components:
        lines.extend(["", "Existing components and public props:"])
        for component in components:
            props = f" — props: {', '.join(component.props)}" if component.props else ""
            lines.append(f"- {component.name} ({component.path}){props}")
    if tokens:
        lines.extend(["", "Existing design tokens and reusable CSS classes:"])
        lines.extend(f"- {token}" for token in tokens)

    lines.extend(
        [
            "",
            "Use this as visual and naming context. Match the existing component APIs,",
            "spacing, colours and conventions where possible. The live preview must remain",
            "self-contained, so do not import local files that are not included in the output.",
        ]
    )
    return "\n".join(lines)


def scan_project(
    name: str,
    files: list[ScannableFile],
    original_file_count: int,
) -> ProjectContextResponse:
    if not files:
        raise HTTPException(
            status_code=400,
            detail="No supported source files were found in this project.",
        )

    components = discover_components(files)
    dependencies = discover_dependencies(files)
    tokens = discover_tokens(files)
    framework_hints = discover_framework_hints(dependencies, files)
    return ProjectContextResponse(
        name=name.strip() or "Imported project",
        file_count=original_file_count,
        analyzed_file_count=len(files),
        component_count=len(components),
        components=components,
        dependencies=dependencies,
        tokens=tokens,
        framework_hints=framework_hints,
        summary=build_summary(
            name.strip() or "Imported project",
            files,
            components,
            dependencies,
            tokens,
            framework_hints,
        ),
    )


@router.post("/api/project-context/scan-files", response_model=ProjectContextResponse)
async def scan_project_files(request: ScanFilesRequest) -> ProjectContextResponse:
    files = collect_files(request.files)
    return scan_project(
        name=request.name or "Imported project",
        files=files,
        original_file_count=len(request.files),
    )


@router.post("/api/project-context/scan-zip", response_model=ProjectContextResponse)
async def scan_project_zip(request: Request) -> ProjectContextResponse:
    payload = bytearray()
    async for chunk in request.stream():
        if len(payload) + len(chunk) > MAX_ARCHIVE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"ZIP is too large; limit is {MAX_ARCHIVE_BYTES // (1024 * 1024)} MB.",
            )
        payload.extend(chunk)
    name, files = decode_zip_files(bytes(payload))
    return scan_project(
        name=unquote(request.headers.get("x-project-name") or name),
        files=files,
        original_file_count=len(files),
    )
