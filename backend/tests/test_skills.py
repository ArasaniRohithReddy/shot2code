from pathlib import Path
from typing import Any

import pytest

from skills.store import (
    SkillFile,
    SkillImportError,
    enabled_skill_directories,
    install_skill,
    list_skills,
    remove_skill,
    set_skill_enabled,
)
from routes.skills import _parse_github_tree_url, _read_github_directory


@pytest.fixture
def skill_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "skills"
    monkeypatch.setenv("SHOT2CODE_SKILLS_DIR", str(root))
    return root


def sample_files() -> list[SkillFile]:
    return [
        SkillFile(
            "my-skill/SKILL.md",
            """---
name: my-skill
description: Helps build accessible interfaces. Use for accessibility work.
license: MIT
---

# My skill
""",
        ),
        SkillFile("my-skill/references/checklist.md", "# Checklist"),
        SkillFile("my-skill/scripts/check.py", "print('not executed')"),
    ]


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (
            "https://github.com/anthropics/skills/tree/main/pdf",
            ("anthropics", "skills", "main", "pdf"),
        ),
        (
            "https://github.com/owner/repo/tree/main/skills/my-skill",
            ("owner", "repo", "main", "skills/my-skill"),
        ),
    ],
)
def test_github_skill_url_accepts_root_and_nested_folders(
    url: str,
    expected: tuple[str, str, str, str],
) -> None:
    assert _parse_github_tree_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/owner/repo/tree/main/skill",
        "https://example.com/owner/repo/tree/main/skill",
        "https://github.com/owner/repo/tree/main",
    ],
)
def test_github_skill_url_rejects_non_folder_urls(url: str) -> None:
    with pytest.raises(SkillImportError):
        _parse_github_tree_url(url)


def test_imported_skill_is_disabled_until_enabled(skill_root: Path) -> None:
    installed = install_skill(sample_files(), source="local folder")

    assert installed.name == "my-skill"
    assert installed.enabled is False
    assert installed.has_scripts is True
    assert enabled_skill_directories() == []

    enabled = set_skill_enabled("my-skill", True)
    assert enabled.enabled is True
    assert enabled_skill_directories() == [
        str((skill_root / "my-skill").resolve())
    ]


def test_import_rejects_traversal_and_duplicate_install(skill_root: Path) -> None:
    install_skill(sample_files(), source="local")
    with pytest.raises(SkillImportError, match="already installed"):
        install_skill(sample_files(), source="local")

    with pytest.raises(SkillImportError):
        install_skill(
            [SkillFile("../SKILL.md", sample_files()[0].content)],
            source="local",
        )


def test_remove_skill_deletes_only_the_named_skill(skill_root: Path) -> None:
    install_skill(sample_files(), source="local")
    keep = skill_root / "keep.txt"
    keep.write_text("keep", encoding="utf-8")

    remove_skill("my-skill")

    assert list_skills() == []
    assert keep.read_text(encoding="utf-8") == "keep"


@pytest.mark.asyncio
async def test_github_directory_fetches_each_file_content() -> None:
    class Response:
        def __init__(self, payload: Any) -> None:
            self.status_code = 200
            self._payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> Any:
            return self._payload

    class Client:
        async def get(
            self,
            url: str,
            **_kwargs: object,
        ) -> Response:
            if url.endswith("/contents/skills/example"):
                return Response(
                    [
                        {
                            "type": "file",
                            "path": "skills/example/SKILL.md",
                            "size": 100,
                        }
                    ]
                )
            return Response(
                {
                    "type": "file",
                    "path": "skills/example/SKILL.md",
                    "encoding": "base64",
                    "content": (
                        "LS0tCm5hbWU6IGV4YW1wbGUKZGVzY3JpcHRpb246IEFuIGV4YW1wbGUgc2tpbGwuCi0tLQo="
                    ),
                }
            )

    files: list[SkillFile] = []
    await _read_github_directory(
        Client(),  # type: ignore[arg-type]
        "owner",
        "repo",
        "main",
        "skills/example",
        "skills/example",
        files,
    )

    assert [file.path for file in files] == ["SKILL.md"]
    assert "name: example" in files[0].content
