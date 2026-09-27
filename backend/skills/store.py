"""Validated, local-only storage for imported Agent Skills."""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable, TypedDict, cast

from history.database import get_history_data_directory

MAX_SKILL_FILES = 64
MAX_SKILL_FILE_BYTES = 256_000
MAX_SKILL_TOTAL_BYTES = 1_500_000
MAX_SKILL_PATH_LENGTH = 240
MAX_SKILL_NAME_LENGTH = 64
MAX_SKILL_DESCRIPTION_LENGTH = 1024
SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REGISTRY_FILENAME = "skills.json"
TEXT_EXTENSIONS = {
    ".md",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".py",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".sh",
    ".ps1",
    ".html",
    ".css",
    ".svg",
}


class SkillImportError(ValueError):
    """An imported skill is unsafe or malformed."""


@dataclass(frozen=True)
class SkillFile:
    path: str
    content: str


@dataclass(frozen=True)
class SkillSummary:
    name: str
    description: str
    license: str | None
    compatibility: str | None
    source: str
    enabled: bool
    file_count: int
    has_scripts: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "description": self.description,
            "license": self.license,
            "compatibility": self.compatibility,
            "source": self.source,
            "enabled": self.enabled,
            "fileCount": self.file_count,
            "hasScripts": self.has_scripts,
        }


def skills_directory() -> Path:
    override = os.environ.get("SHOT2CODE_SKILLS_DIR")
    if override:
        return Path(override).expanduser()
    return get_history_data_directory() / "skills"


def _registry_path() -> Path:
    return skills_directory() / REGISTRY_FILENAME


class SkillRegistryEntry(TypedDict, total=False):
    enabled: bool
    source: str


SkillRegistry = dict[str, SkillRegistryEntry]


def _load_registry() -> SkillRegistry:
    path = _registry_path()
    if not path.exists():
        return {}
    try:
        raw = cast(object, json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    registry: SkillRegistry = {}
    for name, raw_value in cast(dict[object, object], raw).items():
        if not isinstance(name, str) or not isinstance(raw_value, dict):
            continue
        value = cast(dict[str, object], raw_value)
        entry: SkillRegistryEntry = {}
        enabled = value.get("enabled")
        source = value.get("source")
        if isinstance(enabled, bool):
            entry["enabled"] = enabled
        if isinstance(source, str):
            entry["source"] = source
        registry[name] = entry
    return registry


def _save_registry(registry: SkillRegistry) -> None:
    root = skills_directory()
    root.mkdir(parents=True, exist_ok=True)
    destination = _registry_path()
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        dir=root,
        prefix=".skills-",
        suffix=".json",
        delete=False,
    ) as handle:
        json.dump(registry, handle, ensure_ascii=False, indent=2, sort_keys=True)
        temp_path = Path(handle.name)
    os.replace(temp_path, destination)


def _clean_scalar(value: str) -> str:
    candidate = value.strip()
    if (
        len(candidate) >= 2
        and candidate[0] == candidate[-1]
        and candidate[0] in {"'", '"'}
    ):
        candidate = candidate[1:-1].strip()
    return candidate


def parse_skill_markdown(content: str) -> dict[str, str]:
    if not content.startswith("---"):
        raise SkillImportError("SKILL.md must begin with YAML frontmatter.")
    parts = content.split("---", 2)
    if len(parts) < 3:
        raise SkillImportError("SKILL.md frontmatter is not closed.")
    values: dict[str, str] = {}
    for line in parts[1].splitlines():
        if not line.strip() or line.lstrip().startswith("#") or ":" not in line:
            continue
        key, raw_value = line.split(":", 1)
        key = key.strip()
        if key in {
            "name",
            "description",
            "license",
            "compatibility",
            "allowed-tools",
        }:
            values[key] = _clean_scalar(raw_value)

    name = values.get("name", "")
    description = values.get("description", "")
    if not SKILL_NAME_PATTERN.fullmatch(name) or len(name) > MAX_SKILL_NAME_LENGTH:
        raise SkillImportError(
            "Skill name must use lowercase letters, numbers and single hyphens."
        )
    if not description or len(description) > MAX_SKILL_DESCRIPTION_LENGTH:
        raise SkillImportError(
            f"Skill description must be 1-{MAX_SKILL_DESCRIPTION_LENGTH} characters."
        )
    return values


def _safe_relative_path(raw_path: str) -> PurePosixPath:
    candidate = raw_path.replace("\\", "/").strip("/")
    if not candidate or len(candidate) > MAX_SKILL_PATH_LENGTH or "\x00" in candidate:
        raise SkillImportError("A skill file has an invalid path.")
    path = PurePosixPath(candidate)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise SkillImportError("Skill paths must stay inside the skill folder.")
    return path


def _strip_common_skill_root(files: list[SkillFile]) -> list[SkillFile]:
    paths = [_safe_relative_path(file.path) for file in files]
    skill_md_paths = [path for path in paths if path.name == "SKILL.md"]
    if len(skill_md_paths) != 1:
        raise SkillImportError("Import exactly one skill folder containing SKILL.md.")
    root = skill_md_paths[0].parent
    normalized: list[SkillFile] = []
    for file, path in zip(files, paths):
        try:
            relative = path.relative_to(root)
        except ValueError as exc:
            raise SkillImportError(
                "Every imported file must be inside the SKILL.md folder."
            ) from exc
        normalized.append(SkillFile(path=relative.as_posix(), content=file.content))
    return normalized


def validate_skill_files(files: Iterable[SkillFile]) -> tuple[list[SkillFile], dict[str, str]]:
    items = list(files)
    if not items or len(items) > MAX_SKILL_FILES:
        raise SkillImportError(
            f"Import between 1 and {MAX_SKILL_FILES} text files."
        )
    normalized = _strip_common_skill_root(items)
    seen: set[str] = set()
    total_bytes = 0
    skill_content: str | None = None
    for file in normalized:
        path = _safe_relative_path(file.path)
        path_text = path.as_posix()
        if path_text in seen:
            raise SkillImportError(f"Duplicate skill path: {path_text}")
        seen.add(path_text)
        if path.suffix.lower() not in TEXT_EXTENSIONS:
            raise SkillImportError(
                f"'{path_text}' is not a supported text skill resource."
            )
        encoded_size = len(file.content.encode("utf-8"))
        if encoded_size > MAX_SKILL_FILE_BYTES:
            raise SkillImportError(
                f"'{path_text}' exceeds the {MAX_SKILL_FILE_BYTES}-byte limit."
            )
        total_bytes += encoded_size
        if total_bytes > MAX_SKILL_TOTAL_BYTES:
            raise SkillImportError("The skill is too large to import safely.")
        if path_text == "SKILL.md":
            skill_content = file.content
    if skill_content is None:
        raise SkillImportError("The selected folder does not contain SKILL.md.")
    metadata = parse_skill_markdown(skill_content)
    return normalized, metadata


def _skill_summary(
    directory: Path,
    registry: SkillRegistry,
) -> SkillSummary | None:
    skill_md = directory / "SKILL.md"
    if not skill_md.is_file():
        return None
    try:
        metadata = parse_skill_markdown(skill_md.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, SkillImportError):
        return None
    entry = registry.get(metadata["name"], {})
    files = [path for path in directory.rglob("*") if path.is_file()]
    return SkillSummary(
        name=metadata["name"],
        description=metadata["description"],
        license=metadata.get("license") or None,
        compatibility=metadata.get("compatibility") or None,
        source=str(entry.get("source") or "local"),
        enabled=entry.get("enabled") is True,
        file_count=len(files),
        has_scripts=any("scripts" in path.relative_to(directory).parts for path in files),
    )


def list_skills() -> list[SkillSummary]:
    root = skills_directory()
    if not root.exists():
        return []
    registry = _load_registry()
    summaries = [
        summary
        for directory in root.iterdir()
        if directory.is_dir()
        for summary in [_skill_summary(directory, registry)]
        if summary is not None
    ]
    return sorted(summaries, key=lambda item: item.name)


def install_skill(
    files: Iterable[SkillFile],
    *,
    source: str,
) -> SkillSummary:
    normalized, metadata = validate_skill_files(files)
    root = skills_directory()
    root.mkdir(parents=True, exist_ok=True)
    destination = (root / metadata["name"]).resolve()
    if destination.parent != root.resolve():
        raise SkillImportError("The skill destination is invalid.")
    if destination.exists():
        raise SkillImportError(
            f"Skill '{metadata['name']}' is already installed. Remove it first."
        )

    staging = Path(
        tempfile.mkdtemp(prefix=f".{metadata['name']}-", dir=root)
    ).resolve()
    try:
        for file in normalized:
            relative = _safe_relative_path(file.path)
            target = (staging / Path(*relative.parts)).resolve()
            if staging not in target.parents:
                raise SkillImportError("A skill file escaped its staging folder.")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(file.content, encoding="utf-8")
        os.replace(staging, destination)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise

    registry = _load_registry()
    registry[metadata["name"]] = {
        "enabled": False,
        "source": source[:500],
    }
    _save_registry(registry)
    summary = _skill_summary(destination, registry)
    if summary is None:
        raise SkillImportError("The installed skill could not be read back.")
    return summary


def set_skill_enabled(name: str, enabled: bool) -> SkillSummary:
    if not SKILL_NAME_PATTERN.fullmatch(name):
        raise SkillImportError("Invalid skill name.")
    directory = skills_directory() / name
    if not directory.is_dir():
        raise SkillImportError(f"Skill '{name}' is not installed.")
    registry = _load_registry()
    entry = registry.get(name, {})
    entry["enabled"] = enabled
    entry.setdefault("source", "local")
    registry[name] = entry
    _save_registry(registry)
    summary = _skill_summary(directory, registry)
    if summary is None:
        raise SkillImportError(f"Skill '{name}' is invalid.")
    return summary


def remove_skill(name: str) -> None:
    if not SKILL_NAME_PATTERN.fullmatch(name):
        raise SkillImportError("Invalid skill name.")
    root = skills_directory().resolve()
    destination = (root / name).resolve()
    if destination.parent != root or not destination.is_dir():
        raise SkillImportError(f"Skill '{name}' is not installed.")
    shutil.rmtree(destination)
    registry = _load_registry()
    registry.pop(name, None)
    _save_registry(registry)


def enabled_skill_directories() -> list[str]:
    root = skills_directory()
    return [
        str((root / skill.name).resolve())
        for skill in list_skills()
        if skill.enabled
    ]
