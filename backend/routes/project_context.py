import json
import re
import stat
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath, PureWindowsPath
from typing import Literal, cast
from urllib.parse import unquote
from zipfile import BadZipFile, ZipFile, ZipInfo

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field


router = APIRouter()

MAX_ARCHIVE_BYTES = 30 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 5_000
MAX_SELECTED_ENTRIES = 5_000
MAX_FILES = 400
MAX_FILE_BYTES = 600_000
MAX_TOTAL_BYTES = 8 * 1024 * 1024
MAX_COMPONENTS = 60
MAX_TOKENS = 60
MAX_DEPENDENCIES = 80

TEXT_EXTENSIONS = {
    ".cjs", ".css", ".cts", ".html", ".htm", ".js", ".jsx", ".json",
    ".less", ".md", ".mjs", ".mts", ".scss", ".ts", ".tsx", ".vue",
    ".yaml", ".yml",
}

LANGUAGES = {
    ".cjs": "javascript", ".css": "css", ".cts": "typescript",
    ".html": "html", ".htm": "html", ".js": "javascript",
    ".jsx": "javascript", ".json": "json", ".less": "less",
    ".md": "markdown", ".mjs": "javascript", ".mts": "typescript",
    ".scss": "scss", ".ts": "typescript", ".tsx": "typescript",
    ".vue": "vue", ".yaml": "yaml", ".yml": "yaml",
}

SKIPPED_PARTS = {
    ".git", ".next", ".nuxt", ".output", ".svelte-kit", ".venv",
    "build", "coverage", "dist", "node_modules", "out", "target", "vendor",
}

SourceKind = Literal["files", "folder", "zip"]
DetectedStack = Literal[
    "html_css", "html_tailwind", "react_tailwind", "bootstrap",
    "vue_tailwind", "ionic_tailwind", "alpine_tailwind", "preact_tailwind",
    "tailwind_daisyui", "bulma", "material_web", "htmx_tailwind",
]

COMPONENT_EXPORT_RE = re.compile(
    r"""
    export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let)
    \s+(?P<name>[A-Z][A-Za-z0-9_]*)
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


class InspectFilesRequest(ScanFilesRequest):
    source_kind: Literal["files", "folder"] = "files"


class ComponentSummary(BaseModel):
    name: str
    path: str
    props: list[str] = Field(default_factory=list)


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


class EditableProjectFile(BaseModel):
    path: str
    content: str
    language: str
    size_bytes: int


class EditableProjectPayload(BaseModel):
    schema_version: Literal[1] = 1
    name: str
    source_kind: SourceKind
    files: list[EditableProjectFile]
    entry_path: str | None
    detected_stack: DetectedStack | None
    confidence: float = Field(ge=0.0, le=1.0)
    reasons: list[str]
    framework_hints: list[str]
    ignored_file_count: int
    warnings: list[str]


class ProjectInspectionResponse(BaseModel):
    context: ProjectContextResponse
    project: EditableProjectPayload


@dataclass(frozen=True)
class ScannableFile:
    path: str
    content: str


@dataclass(frozen=True)
class CollectedFiles:
    files: list[ScannableFile]
    ignored_file_count: int
    original_file_count: int


@dataclass(frozen=True)
class DecodedZipProject:
    name: str
    files: list[ScannableFile]
    ignored_file_count: int
    original_file_count: int


@dataclass(frozen=True)
class StackDetection:
    detected_stack: DetectedStack | None
    confidence: float
    reasons: list[str]
    framework_hints: list[str]


@dataclass
class DetectionSignals:
    scores: dict[str, int]
    reasons: dict[str, list[str]]
    hints: set[str]

    @classmethod
    def create(cls) -> "DetectionSignals":
        return cls(scores={}, reasons={}, hints=set())

    def add(self, key: str, score: int, reason: str, *hints: str) -> None:
        reasons = self.reasons.setdefault(key, [])
        if reason not in reasons:
            reasons.append(reason)
            self.scores[key] = self.scores.get(key, 0) + score
        self.hints.update(hints)


def _path_label(raw_path: str) -> str:
    display = raw_path.replace("\x00", "\\0")
    if len(display) > 120:
        display = f"{display[:117]}..."
    return repr(display)


def _invalid_path(raw_path: str, reason: str) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail=f"Invalid project path {_path_label(raw_path)}: {reason}.",
    )


def _validated_relative_path(raw_path: str) -> str:
    if not raw_path:
        raise _invalid_path(raw_path, "the path is empty")
    if "\x00" in raw_path:
        raise _invalid_path(raw_path, "NUL bytes are not allowed")

    normalized_slashes = raw_path.replace("\\", "/")
    if normalized_slashes.startswith("/"):
        raise _invalid_path(raw_path, "absolute and UNC paths are not allowed")
    if PureWindowsPath(raw_path).drive or re.match(r"^[A-Za-z]:", normalized_slashes):
        raise _invalid_path(raw_path, "drive-qualified paths are not allowed")

    raw_parts = normalized_slashes.split("/")
    if ".." in raw_parts:
        raise _invalid_path(raw_path, "parent-directory traversal is not allowed")

    parts = [part for part in raw_parts if part not in {"", "."}]
    if not parts:
        raise _invalid_path(raw_path, "the path has no file or directory name")
    if re.match(r"^[A-Za-z]:", parts[0]):
        raise _invalid_path(raw_path, "drive-qualified paths are not allowed")
    return "/".join(parts)


def _is_ignored_path(path: str) -> bool:
    return any(part.casefold() in SKIPPED_PARTS for part in PurePosixPath(path).parts)


def _is_supported_path(path: str) -> bool:
    return PurePosixPath(path).suffix.casefold() in TEXT_EXTENSIONS


def normalize_project_path(raw_path: str) -> str | None:
    path = _validated_relative_path(raw_path)
    if _is_ignored_path(path) or not _is_supported_path(path):
        return None
    return path


def _encoded_size(path: str, content: str) -> int:
    try:
        return len(content.encode("utf-8"))
    except UnicodeEncodeError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Supported source file {path!r} cannot be encoded as valid UTF-8.",
        ) from exc


def _is_apparent_binary(content: str) -> bool:
    if "\x00" in content:
        return True
    control_count = sum(
        1
        for character in content
        if (ord(character) < 32 and character not in "\t\n\r") or ord(character) == 127
    )
    return control_count > max(8, len(content) // 20)


def _validate_supported_content(path: str, content: str) -> int:
    size_bytes = _encoded_size(path, content)
    if size_bytes > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Supported source file {path!r} is too large; limit is {MAX_FILE_BYTES} bytes.",
        )
    if _is_apparent_binary(content):
        raise HTTPException(
            status_code=400,
            detail=f"Supported source file {path!r} appears to contain binary data.",
        )
    return size_bytes


def _collect_files(raw_files: list[ProjectFile]) -> CollectedFiles:
    if len(raw_files) > MAX_SELECTED_ENTRIES:
        raise HTTPException(
            status_code=413,
            detail=f"Project contains too many selected entries; limit is {MAX_SELECTED_ENTRIES}.",
        )

    files: list[ScannableFile] = []
    ignored_file_count = 0
    total_bytes = 0
    normalized_paths: set[str] = set()

    for raw_file in raw_files:
        normalized = _validated_relative_path(raw_file.path)
        duplicate_key = normalized.casefold()
        if duplicate_key in normalized_paths:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate normalized project path {normalized!r}.",
            )
        normalized_paths.add(duplicate_key)

        if _is_ignored_path(normalized) or not _is_supported_path(normalized):
            ignored_file_count += 1
            continue
        if len(files) >= MAX_FILES:
            raise HTTPException(
                status_code=413,
                detail=f"Project contains more than {MAX_FILES} supported source files.",
            )

        size_bytes = _validate_supported_content(normalized, raw_file.content)
        total_bytes += size_bytes
        if total_bytes > MAX_TOTAL_BYTES:
            raise HTTPException(
                status_code=413,
                detail=(
                    "Project source is too large; supported text is limited to "
                    f"{MAX_TOTAL_BYTES // (1024 * 1024)} MiB."
                ),
            )
        files.append(ScannableFile(path=normalized, content=raw_file.content))

    return CollectedFiles(files, ignored_file_count, len(raw_files))


def collect_files(raw_files: list[ProjectFile]) -> list[ScannableFile]:
    return _collect_files(raw_files).files

def _zip_entry_is_symlink(entry: ZipInfo) -> bool:
    return stat.S_ISLNK((entry.external_attr >> 16) & 0xFFFF)


def _malformed_zip() -> HTTPException:
    return HTTPException(
        status_code=400,
        detail="The uploaded file is not a valid ZIP archive.",
    )


def _decode_zip_project(payload: bytes) -> DecodedZipProject:
    if len(payload) > MAX_ARCHIVE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"ZIP is too large; limit is {MAX_ARCHIVE_BYTES // (1024 * 1024)} MB.",
        )

    try:
        with ZipFile(BytesIO(payload)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ARCHIVE_ENTRIES:
                raise HTTPException(
                    status_code=413,
                    detail=f"ZIP contains too many entries; limit is {MAX_ARCHIVE_ENTRIES}.",
                )

            selected_entries: list[tuple[ZipInfo, str]] = []
            ignored_file_count = 0
            original_file_count = 0
            total_declared_bytes = 0
            normalized_paths: set[str] = set()

            for entry in entries:
                normalized = _validated_relative_path(entry.filename)
                if entry.flag_bits & 0x1:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Encrypted ZIP entry {normalized!r} is not supported.",
                    )
                if _zip_entry_is_symlink(entry):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Symbolic-link ZIP entry {normalized!r} is not allowed.",
                    )
                if entry.is_dir():
                    continue

                original_file_count += 1
                duplicate_key = normalized.casefold()
                if duplicate_key in normalized_paths:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Duplicate normalized ZIP path {normalized!r}.",
                    )
                normalized_paths.add(duplicate_key)

                if _is_ignored_path(normalized) or not _is_supported_path(normalized):
                    ignored_file_count += 1
                    continue
                if len(selected_entries) >= MAX_FILES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"ZIP contains more than {MAX_FILES} supported source files.",
                    )
                if entry.file_size > MAX_FILE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"Supported source file {normalized!r} is too large; "
                            f"limit is {MAX_FILE_BYTES} bytes."
                        ),
                    )

                total_declared_bytes += entry.file_size
                if total_declared_bytes > MAX_TOTAL_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            "ZIP source is too large; supported text is limited to "
                            f"{MAX_TOTAL_BYTES // (1024 * 1024)} MiB uncompressed."
                        ),
                    )
                selected_entries.append((entry, normalized))

            files: list[ScannableFile] = []
            total_actual_bytes = 0
            for entry, normalized in selected_entries:
                with archive.open(entry, "r") as source:
                    raw = source.read(MAX_FILE_BYTES + 1)
                if len(raw) > MAX_FILE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"Supported source file {normalized!r} is too large; "
                            f"limit is {MAX_FILE_BYTES} bytes."
                        ),
                    )

                total_actual_bytes += len(raw)
                if total_actual_bytes > MAX_TOTAL_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            "ZIP source is too large; supported text is limited to "
                            f"{MAX_TOTAL_BYTES // (1024 * 1024)} MiB uncompressed."
                        ),
                    )
                try:
                    content = raw.decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Supported source file {normalized!r} is not valid UTF-8.",
                    ) from exc
                if _is_apparent_binary(content):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Supported source file {normalized!r} appears to contain binary data.",
                    )
                files.append(ScannableFile(path=normalized, content=content))
    except HTTPException:
        raise
    except (BadZipFile, EOFError, NotImplementedError, OSError, RuntimeError) as exc:
        raise _malformed_zip() from exc

    project_name = _shared_wrapper_root(files) or "Imported project"
    return DecodedZipProject(
        name=project_name,
        files=files,
        ignored_file_count=ignored_file_count,
        original_file_count=original_file_count,
    )


def decode_zip_files(payload: bytes) -> tuple[str, list[ScannableFile]]:
    decoded = _decode_zip_project(payload)
    return decoded.name, decoded.files


def _shared_wrapper_root(files: list[ScannableFile]) -> str | None:
    if not files:
        return None
    paths = [PurePosixPath(file.path) for file in files]
    if any(len(path.parts) < 2 for path in paths):
        return None
    roots = {path.parts[0] for path in paths}
    return next(iter(roots)) if len(roots) == 1 else None


def _strip_wrapper_root(
    files: list[ScannableFile], source_kind: SourceKind
) -> tuple[list[ScannableFile], str | None]:
    if source_kind not in {"folder", "zip"}:
        return files, None
    root = _shared_wrapper_root(files)
    if root is None:
        return files, None
    stripped = [
        ScannableFile(
            path="/".join(PurePosixPath(file.path).parts[1:]),
            content=file.content,
        )
        for file in files
    ]
    return stripped, root


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
    script_extensions = {".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"}
    for file in files:
        suffix = PurePosixPath(file.path).suffix.lower()
        if suffix == ".vue":
            name = PurePosixPath(file.path).stem
            if name and name[0].isupper():
                components.append(ComponentSummary(name=name, path=file.path))
            continue
        if suffix not in script_extensions:
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


def _discover_dependency_names(files: list[ScannableFile]) -> list[str]:
    dependencies: list[str] = []
    for file in files:
        if PurePosixPath(file.path).name.casefold() != "package.json":
            continue
        try:
            parsed: object = json.loads(file.content)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        package = cast(dict[str, object], parsed)
        for section in (
            "dependencies",
            "devDependencies",
            "peerDependencies",
            "optionalDependencies",
        ):
            values = package.get(section)
            if isinstance(values, dict):
                dependencies.extend(
                    str(name) for name in cast(dict[str, object], values)
                )
    return sorted(set(dependencies), key=str.casefold)


def discover_dependencies(files: list[ScannableFile]) -> list[str]:
    return _discover_dependency_names(files)[:MAX_DEPENDENCIES]


def _has_dependency(dependencies: set[str], *names: str) -> bool:
    return any(name in dependencies for name in names)


def _has_dependency_prefix(dependencies: set[str], *prefixes: str) -> bool:
    return any(
        dependency == prefix or dependency.startswith(f"{prefix}/")
        for dependency in dependencies
        for prefix in prefixes
    )


def _quoted_module(content: str, module: str) -> bool:
    return re.search(
        rf"['\"]{re.escape(module)}(?:/[^'\"]*)?['\"]",
        content,
        re.IGNORECASE,
    ) is not None


def _stack_confidence(score: int) -> float:
    if score >= 8:
        return 0.99
    if score >= 6:
        return 0.96
    if score >= 5:
        return 0.93
    if score >= 4:
        return 0.88
    if score >= 3:
        return 0.8
    if score >= 2:
        return 0.7
    return 0.55

def detect_project_stack(
    dependencies: list[str], files: list[ScannableFile]
) -> StackDetection:
    signals = DetectionSignals.create()
    dependency_set = {
        dependency.casefold()
        for dependency in [*dependencies, *_discover_dependency_names(files)]
    }

    if _has_dependency(dependency_set, "next"):
        signals.add("react", 6, "package.json declares Next.js.", "Next.js", "React")
    if _has_dependency(dependency_set, "react", "react-dom"):
        signals.add("react", 5, "package.json declares React.", "React")
    if _has_dependency(dependency_set, "preact"):
        signals.add("preact", 6, "package.json declares Preact.", "Preact")
    if _has_dependency(dependency_set, "vue"):
        signals.add("vue", 5, "package.json declares Vue.", "Vue")
    if _has_dependency(dependency_set, "nuxt"):
        signals.add("vue", 6, "package.json declares Nuxt.", "Nuxt", "Vue")
    if _has_dependency_prefix(dependency_set, "@ionic") or _has_dependency(
        dependency_set, "ionic"
    ):
        signals.add("ionic", 7, "package.json declares Ionic.", "Ionic")
    if _has_dependency(dependency_set, "@ionic/react"):
        signals.add("react", 3, "Ionic uses its React runtime package.", "React")
    if _has_dependency(dependency_set, "@ionic/vue"):
        signals.add("vue", 3, "Ionic uses its Vue runtime package.", "Vue")
    if _has_dependency(dependency_set, "@ionic/angular"):
        signals.hints.add("Angular")
    if _has_dependency(dependency_set, "alpinejs") or _has_dependency_prefix(
        dependency_set, "@alpinejs"
    ):
        signals.add("alpine", 5, "package.json declares Alpine.js.", "Alpine.js")
    if _has_dependency(dependency_set, "htmx.org", "htmx"):
        signals.add("htmx", 5, "package.json declares htmx.", "htmx")

    if _has_dependency(dependency_set, "tailwindcss") or _has_dependency_prefix(
        dependency_set, "@tailwindcss"
    ):
        signals.add("tailwind", 5, "package.json declares Tailwind CSS.", "Tailwind CSS")
    if _has_dependency(dependency_set, "daisyui"):
        signals.add(
            "daisyui", 6, "package.json declares daisyUI.", "daisyUI", "Tailwind CSS"
        )
    if _has_dependency(dependency_set, "bootstrap", "react-bootstrap"):
        signals.add("bootstrap", 5, "package.json declares Bootstrap.", "Bootstrap")
    if _has_dependency(dependency_set, "react-bootstrap"):
        signals.add("react", 3, "react-bootstrap implies a React runtime.", "React")
    if _has_dependency(dependency_set, "bulma"):
        signals.add("bulma", 5, "package.json declares Bulma.", "Bulma")
    if _has_dependency(dependency_set, "@material/web", "material-components-web"):
        signals.add(
            "material", 6, "package.json declares Material Web.", "Material Web"
        )
    if _has_dependency(dependency_set, "@mui/material"):
        signals.add(
            "react", 2, "Material UI implies a React runtime.", "React", "Material UI"
        )
    if _has_dependency(dependency_set, "@chakra-ui/react"):
        signals.add(
            "react", 2, "Chakra UI implies a React runtime.", "React", "Chakra UI"
        )
    if _has_dependency(dependency_set, "svelte") or _has_dependency_prefix(
        dependency_set, "@sveltejs"
    ):
        signals.hints.add("Svelte")
    if _has_dependency_prefix(dependency_set, "@angular"):
        signals.hints.add("Angular")

    for file in files:
        path = PurePosixPath(file.path)
        name = path.name.casefold()
        suffix = path.suffix.casefold()
        content = file.content
        lower_content = content.casefold()

        if name.startswith("tailwind.config."):
            signals.add(
                "tailwind", 5, f"Found Tailwind config {file.path}.", "Tailwind CSS"
            )
        if name == "ionic.config.json":
            signals.add("ionic", 6, "Found ionic.config.json.", "Ionic")
        if "/components/ui/" in f"/{file.path.casefold()}":
            signals.add(
                "react", 2, "Found a shadcn/ui component path.", "React", "shadcn/ui"
            )

        if suffix == ".vue":
            signals.add(
                "vue", 5, f"Found Vue single-file component {file.path}.", "Vue"
            )
        if suffix in {".jsx", ".tsx"}:
            signals.add("react", 2, "Found JSX/TSX source files.", "React")

        if name != "package.json":
            if _quoted_module(content, "preact") or "preact/compat" in lower_content:
                signals.add("preact", 5, f"{file.path} references Preact.", "Preact")
            if (
                _quoted_module(content, "react")
                or _quoted_module(content, "react-dom")
                or "reactdom.createroot" in lower_content
            ):
                signals.add("react", 4, f"{file.path} references React.", "React")
            if _quoted_module(content, "vue") or "createapp(" in lower_content:
                signals.add("vue", 4, f"{file.path} references Vue.", "Vue")
            if _quoted_module(content, "@ionic") or "@ionic/" in lower_content:
                signals.add("ionic", 6, f"{file.path} imports Ionic.", "Ionic")
            if _quoted_module(content, "alpinejs") or "alpinejs" in lower_content:
                signals.add(
                    "alpine", 4, f"{file.path} references Alpine.js.", "Alpine.js"
                )
            if _quoted_module(content, "htmx.org"):
                signals.add("htmx", 4, f"{file.path} references htmx.", "htmx")
            if _quoted_module(content, "tailwindcss"):
                signals.add(
                    "tailwind",
                    4,
                    f"{file.path} references Tailwind CSS.",
                    "Tailwind CSS",
                )
            if _quoted_module(content, "daisyui"):
                signals.add(
                    "daisyui",
                    5,
                    f"{file.path} references daisyUI.",
                    "daisyUI",
                    "Tailwind CSS",
                )
            if _quoted_module(content, "bootstrap"):
                signals.add(
                    "bootstrap", 4, f"{file.path} references Bootstrap.", "Bootstrap"
                )
            if _quoted_module(content, "bulma"):
                signals.add("bulma", 4, f"{file.path} references Bulma.", "Bulma")
            if _quoted_module(content, "@material/web"):
                signals.add(
                    "material", 5, f"{file.path} imports Material Web.", "Material Web"
                )

        if "cdn.tailwindcss.com" in lower_content or re.search(
            r"@(?:tailwind\s|import\s+['\"]tailwindcss)", content, re.IGNORECASE
        ):
            signals.add(
                "tailwind",
                5,
                f"{file.path} contains a Tailwind CSS signature.",
                "Tailwind CSS",
            )
        if "daisyui" in lower_content:
            signals.add(
                "daisyui",
                6,
                f"{file.path} contains a daisyUI signature.",
                "daisyUI",
                "Tailwind CSS",
            )
        if re.search(
            r"bootstrap(?:\.bundle)?(?:\.min)?\.(?:css|js)|\bdata-bs-",
            lower_content,
        ):
            signals.add(
                "bootstrap",
                5,
                f"{file.path} contains a Bootstrap signature.",
                "Bootstrap",
            )
        if re.search(r"bulma(?:\.min)?\.css", lower_content) or (
            "cdn.jsdelivr.net/npm/bulma" in lower_content
        ):
            signals.add(
                "bulma", 5, f"{file.path} references a Bulma stylesheet.", "Bulma"
            )
        if "@material/web" in lower_content or re.search(
            r"<md-(?:filled|outlined|elevated|text|icon|switch|checkbox|radio|slider|tabs?)\b",
            lower_content,
        ):
            signals.add(
                "material",
                5,
                f"{file.path} contains a Material Web signature.",
                "Material Web",
            )
        if "cdn.jsdelivr.net/npm/alpinejs" in lower_content or re.search(
            r"\bx-(?:data|show|if|for|model|bind|on)(?::|=)", lower_content
        ):
            signals.add(
                "alpine",
                5,
                f"{file.path} contains an Alpine.js signature.",
                "Alpine.js",
            )
        if "htmx.org" in lower_content or re.search(
            r"\bhx-(?:get|post|put|patch|delete|trigger|target|swap)=", lower_content
        ):
            signals.add(
                "htmx", 5, f"{file.path} contains an htmx signature.", "htmx"
            )
        if "unpkg.com/preact" in lower_content or "esm.sh/preact" in lower_content:
            signals.add(
                "preact", 5, f"{file.path} references the Preact CDN.", "Preact"
            )
        if "unpkg.com/react" in lower_content or "cdn.jsdelivr.net/npm/react" in lower_content:
            signals.add("react", 5, f"{file.path} references the React CDN.", "React")
        if (
            "unpkg.com/vue" in lower_content
            or "cdn.jsdelivr.net/npm/vue" in lower_content
            or "vue.global" in lower_content
        ):
            signals.add("vue", 5, f"{file.path} references the Vue CDN.", "Vue")
        if "cdn.jsdelivr.net/npm/@ionic" in lower_content or re.search(
            r"<ion-(?:app|content|header|toolbar|title|button|page)\b", lower_content
        ):
            signals.add(
                "ionic", 6, f"{file.path} contains an Ionic signature.", "Ionic"
            )

        if suffix in {".html", ".htm"}:
            if name in {"index.html", "index.htm"}:
                signals.add("html", 4, f"Found HTML entry point {file.path}.")
            else:
                signals.add("html", 2, "Found HTML source files.")
        elif suffix in {".css", ".less", ".scss"}:
            signals.add("html", 1, "Found stylesheet source files.")

    runtime_mapping: dict[str, DetectedStack] = {
        "react": "react_tailwind",
        "vue": "vue_tailwind",
        "ionic": "ionic_tailwind",
        "alpine": "alpine_tailwind",
        "preact": "preact_tailwind",
        "htmx": "htmx_tailwind",
    }
    runtime_priority = {
        "ionic": 6,
        "preact": 5,
        "vue": 4,
        "react": 3,
        "alpine": 2,
        "htmx": 1,
    }
    runtime_candidates = [
        key for key in runtime_mapping if signals.scores.get(key, 0) > 0
    ]

    selected_key: str | None = None
    detected_stack: DetectedStack | None = None
    if runtime_candidates:
        selected_key = max(
            runtime_candidates,
            key=lambda key: (runtime_priority[key], signals.scores[key]),
        )
        detected_stack = runtime_mapping[selected_key]
    else:
        style_mapping: dict[str, DetectedStack] = {
            "daisyui": "tailwind_daisyui",
            "bootstrap": "bootstrap",
            "bulma": "bulma",
            "material": "material_web",
            "tailwind": "html_tailwind",
        }
        style_priority = {
            "daisyui": 5,
            "bootstrap": 4,
            "bulma": 3,
            "material": 2,
            "tailwind": 1,
        }
        style_candidates = [
            key for key in style_mapping if signals.scores.get(key, 0) > 0
        ]
        if style_candidates:
            selected_key = max(
                style_candidates,
                key=lambda key: (signals.scores[key], style_priority[key]),
            )
            detected_stack = style_mapping[selected_key]
        elif signals.scores.get("html", 0) > 0:
            selected_key = "html"
            detected_stack = "html_css"

    hint_order = [
        "Next.js", "React", "Preact", "Vue", "Nuxt", "Ionic", "Angular",
        "Svelte", "Alpine.js", "htmx", "Tailwind CSS", "daisyUI",
        "Bootstrap", "Bulma", "Material Web", "Material UI", "Chakra UI",
        "shadcn/ui",
    ]
    framework_hints = [hint for hint in hint_order if hint in signals.hints]

    if selected_key is None:
        reasons = ["No supported application stack signature was found."]
        if framework_hints:
            reasons.append(
                "Detected framework hints do not map to an available frontend Stack value."
            )
        return StackDetection(None, 0.0, reasons, framework_hints)

    reasons = list(signals.reasons.get(selected_key, []))
    for style_key in ("tailwind", "daisyui", "bootstrap", "bulma", "material"):
        if style_key == selected_key or signals.scores.get(style_key, 0) == 0:
            continue
        for reason in signals.reasons.get(style_key, [])[:1]:
            if reason not in reasons:
                reasons.append(reason)
    if selected_key in runtime_mapping and any(
        signals.scores.get(key, 0) > 0
        for key in ("bootstrap", "bulma", "material", "daisyui")
    ):
        reasons.append(
            "Runtime framework evidence takes precedence over styling-library evidence."
        )

    return StackDetection(
        detected_stack=detected_stack,
        confidence=_stack_confidence(signals.scores[selected_key]),
        reasons=reasons[:8],
        framework_hints=framework_hints,
    )


def discover_framework_hints(
    dependencies: list[str], files: list[ScannableFile]
) -> list[str]:
    return detect_project_stack(dependencies, files).framework_hints

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

    normalized_name = name.strip() or "Imported project"
    components = discover_components(files)
    dependencies = discover_dependencies(files)
    tokens = discover_tokens(files)
    detection = detect_project_stack(dependencies, files)
    return ProjectContextResponse(
        name=normalized_name,
        file_count=original_file_count,
        analyzed_file_count=len(files),
        component_count=len(components),
        components=components,
        dependencies=dependencies,
        tokens=tokens,
        framework_hints=detection.framework_hints,
        summary=build_summary(
            normalized_name,
            files,
            components,
            dependencies,
            tokens,
            detection.framework_hints,
        ),
    )


def _entry_candidates(stack: DetectedStack | None) -> list[str]:
    if stack == "react_tailwind":
        return [
            "src/App.tsx", "src/App.jsx", "src/App.ts", "src/App.js",
            "App.tsx", "App.jsx", "src/main.tsx", "src/main.jsx",
            "src/index.tsx", "src/index.jsx", "app/page.tsx",
            "pages/index.tsx", "index.html",
        ]
    if stack == "preact_tailwind":
        return [
            "src/app.tsx", "src/App.tsx", "src/app.jsx", "src/App.jsx",
            "src/main.tsx", "src/index.tsx", "index.html",
        ]
    if stack == "vue_tailwind":
        return [
            "src/App.vue", "App.vue", "src/app.vue", "src/main.ts",
            "src/main.js", "index.html",
        ]
    if stack == "ionic_tailwind":
        return [
            "src/App.tsx", "src/App.jsx", "src/App.vue",
            "src/app/app.component.ts", "src/main.ts", "src/main.tsx",
            "index.html",
        ]
    return ["index.html", "index.htm", "src/index.html", "public/index.html"]


def suggest_entry_path(
    files: list[ScannableFile], stack: DetectedStack | None
) -> str | None:
    by_casefolded_path = {file.path.casefold(): file.path for file in files}
    for candidate in _entry_candidates(stack):
        match = by_casefolded_path.get(candidate.casefold())
        if match is not None:
            return match

    ordered_paths = sorted(
        (file.path for file in files),
        key=lambda path: (len(PurePosixPath(path).parts), path.casefold(), path),
    )
    for path in ordered_paths:
        if PurePosixPath(path).name.casefold() in {"index.html", "index.htm"}:
            return path
    entry_extensions = {
        ".cjs", ".css", ".cts", ".html", ".htm", ".js", ".jsx", ".mjs",
        ".mts", ".scss", ".ts", ".tsx", ".vue",
    }
    for path in ordered_paths:
        pure_path = PurePosixPath(path)
        if (
            pure_path.stem.casefold() in {"app", "main", "index"}
            and pure_path.suffix.casefold() in entry_extensions
        ):
            return path
    for path in ordered_paths:
        if PurePosixPath(path).suffix.casefold() not in {".json", ".md", ".yaml", ".yml"}:
            return path
    return None


def _project_warnings(ignored_file_count: int, entry_path: str | None) -> list[str]:
    warnings: list[str] = []
    if ignored_file_count:
        noun = "file was" if ignored_file_count == 1 else "files were"
        warnings.append(
            f"{ignored_file_count} unsupported or ignored {noun} omitted from the editable project."
        )
    if entry_path is None:
        warnings.append("No likely application entry file was found.")
    return warnings


def build_project_inspection(
    name: str,
    files: list[ScannableFile],
    original_file_count: int,
    source_kind: SourceKind,
    ignored_file_count: int,
) -> ProjectInspectionResponse:
    if not files:
        raise HTTPException(
            status_code=400,
            detail="No supported source files were found in this project.",
        )

    normalized_name = name.strip() or "Imported project"
    dependencies = discover_dependencies(files)
    detection = detect_project_stack(dependencies, files)
    entry_path = suggest_entry_path(files, detection.detected_stack)
    context = scan_project(normalized_name, files, original_file_count)
    editable_files = [
        EditableProjectFile(
            path=file.path,
            content=file.content,
            language=LANGUAGES[PurePosixPath(file.path).suffix.casefold()],
            size_bytes=_encoded_size(file.path, file.content),
        )
        for file in files
    ]
    return ProjectInspectionResponse(
        context=context,
        project=EditableProjectPayload(
            name=normalized_name,
            source_kind=source_kind,
            files=editable_files,
            entry_path=entry_path,
            detected_stack=detection.detected_stack,
            confidence=detection.confidence,
            reasons=detection.reasons,
            framework_hints=detection.framework_hints,
            ignored_file_count=ignored_file_count,
            warnings=_project_warnings(ignored_file_count, entry_path),
        ),
    )


async def _read_zip_request(request: Request) -> bytes:
    payload = bytearray()
    async for chunk in request.stream():
        if len(payload) + len(chunk) > MAX_ARCHIVE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"ZIP is too large; limit is {MAX_ARCHIVE_BYTES // (1024 * 1024)} MB.",
            )
        payload.extend(chunk)
    return bytes(payload)


def _request_project_name(request: Request, fallback: str) -> str:
    requested_name = unquote(request.headers.get("x-project-name") or "").strip()
    return requested_name or fallback


@router.post("/api/project-context/scan-files", response_model=ProjectContextResponse)
async def scan_project_files(request: ScanFilesRequest) -> ProjectContextResponse:
    collected = _collect_files(request.files)
    return scan_project(
        name=request.name or "Imported project",
        files=collected.files,
        original_file_count=collected.original_file_count,
    )


@router.post("/api/project-context/scan-zip", response_model=ProjectContextResponse)
async def scan_project_zip(request: Request) -> ProjectContextResponse:
    decoded = _decode_zip_project(await _read_zip_request(request))
    return scan_project(
        name=_request_project_name(request, decoded.name),
        files=decoded.files,
        original_file_count=decoded.original_file_count,
    )


@router.post(
    "/api/project-context/inspect-files", response_model=ProjectInspectionResponse
)
async def inspect_project_files(
    request: InspectFilesRequest,
) -> ProjectInspectionResponse:
    collected = _collect_files(request.files)
    files, wrapper_root = _strip_wrapper_root(collected.files, request.source_kind)
    return build_project_inspection(
        name=request.name or wrapper_root or "Imported project",
        files=files,
        original_file_count=collected.original_file_count,
        source_kind=request.source_kind,
        ignored_file_count=collected.ignored_file_count,
    )


@router.post(
    "/api/project-context/inspect-zip", response_model=ProjectInspectionResponse
)
async def inspect_project_zip(request: Request) -> ProjectInspectionResponse:
    decoded = _decode_zip_project(await _read_zip_request(request))
    files, wrapper_root = _strip_wrapper_root(decoded.files, "zip")
    return build_project_inspection(
        name=_request_project_name(request, wrapper_root or decoded.name),
        files=files,
        original_file_count=decoded.original_file_count,
        source_kind="zip",
        ignored_file_count=decoded.ignored_file_count,
    )
