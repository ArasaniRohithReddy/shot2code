from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from history.database import (
    LATEST_SCHEMA_VERSION,
    HistoryConflictError,
    HistoryDataError,
    HistoryValidationError,
    encode_json,
    get_history_db_path,
    open_history_db,
)
from history.models import (
    HistoryMessageInput,
    ProjectSnapshotRequest,
    PromptInput,
    SelectionUpdateRequest,
    VariantInput,
    VersionInput,
)
from history.store import HistoryStore
from routes.history import router


@pytest.fixture
def database_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "shot2code" / "history.sqlite3"
    monkeypatch.setenv("SHOT2CODE_HISTORY_DB_PATH", str(path))
    monkeypatch.delenv("SHOT2CODE_DATA_DIR", raising=False)
    return path


def _version(
    version_id: str,
    *,
    parent_id: str | None = None,
    retry_of_id: str | None = None,
    version_type: str = "create",
    code: str = "<main>first</main>",
    variant_index: int = 0,
) -> VersionInput:
    return VersionInput(
        id=version_id,
        commit_hash=f"hash-{version_id}",
        parent_commit_id=parent_id,
        retry_of_commit_id=retry_of_id,
        version_type=version_type,
        inputs={"mode": "image", "screenshots": ["screen-1"]},
        prompt_metadata={"temperature": 0.2},
        metadata={"source": "test"},
        prompts=[
            PromptInput(
                id="shared-prompt-id",
                role="user",
                kind="generation",
                content={"text": f"build {version_id}"},
                metadata={"sequence": 1},
            )
        ],
        variants=[
            VariantInput(
                index=variant_index,
                model="test-model",
                status="completed",
                code=code,
                current_content=code,
                duration_ms=42,
                metadata={"quality": "selected"},
                messages=[
                    HistoryMessageInput(
                        id="shared-message-id",
                        role="user",
                        content="Please refine the result",
                        media=[{"type": "image", "url": "local://screen-1"}],
                        metadata={"turn": 1},
                    ),
                    HistoryMessageInput(
                        role="assistant",
                        content="Done",
                        metadata={"turn": 2},
                    ),
                ],
            )
        ],
    )


def _snapshot(version: VersionInput | None = None) -> ProjectSnapshotRequest:
    return ProjectSnapshotRequest(
        title="Landing page",
        stack="react_tailwind",
        input_mode="image",
        metadata={"favorite": True},
        version=version,
        selected_variant_index=0 if version is not None else None,
    )


def _counts(path: Path) -> dict[str, int]:
    conn = open_history_db(path)
    try:
        return {
            table: int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in (
                "projects",
                "commits",
                "variants",
                "prompts",
                "variant_messages",
            )
        }
    finally:
        conn.close()


def test_database_path_prefers_explicit_file(
    database_path: Path,
) -> None:
    assert get_history_db_path() == database_path


def test_database_path_uses_configured_data_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SHOT2CODE_HISTORY_DB_PATH", raising=False)
    monkeypatch.setenv("SHOT2CODE_DATA_DIR", str(tmp_path / "data"))

    assert get_history_db_path() == tmp_path / "data" / "history.sqlite3"


def test_migrations_are_versioned_and_idempotent(database_path: Path) -> None:
    first = open_history_db(database_path)
    try:
        first_versions = first.execute(
            "SELECT version, name FROM schema_migrations ORDER BY version"
        ).fetchall()
        first_triggers = first.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name"
        ).fetchall()
        assert int(first.execute("PRAGMA user_version").fetchone()[0]) == LATEST_SCHEMA_VERSION
        assert int(first.execute("PRAGMA foreign_keys").fetchone()[0]) == 1
    finally:
        first.close()

    second = open_history_db(database_path)
    try:
        second_versions = second.execute(
            "SELECT version, name FROM schema_migrations ORDER BY version"
        ).fetchall()
        second_triggers = second.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name"
        ).fetchall()
    finally:
        second.close()

    assert [(row[0], row[1]) for row in first_versions] == [
        (1, "initial_history_schema"),
        (2, "append_only_and_selection_guards"),
    ]
    assert [tuple(row) for row in second_versions] == [
        tuple(row) for row in first_versions
    ]
    assert [row[0] for row in second_triggers] == [row[0] for row in first_triggers]

    downgrade = sqlite3.connect(database_path)
    try:
        downgrade.execute("DROP TRIGGER messages_append_only_update")
        downgrade.execute("DELETE FROM schema_migrations WHERE version = 2")
        downgrade.execute("PRAGMA user_version = 1")
        downgrade.commit()
    finally:
        downgrade.close()

    upgraded = open_history_db(database_path)
    try:
        assert int(upgraded.execute("PRAGMA user_version").fetchone()[0]) == 2
        assert upgraded.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?",
            ("messages_append_only_update",),
        ).fetchone()
    finally:
        upgraded.close()


def test_newer_schema_is_rejected(database_path: Path) -> None:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(database_path)
    try:
        conn.execute("PRAGMA user_version = 999")
        conn.commit()
    finally:
        conn.close()

    with pytest.raises(HistoryDataError, match="newer"):
        open_history_db(database_path)


def test_foreign_keys_and_same_project_ancestry_are_enforced(
    database_path: Path,
) -> None:
    conn = open_history_db(database_path)
    try:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO commits(
                    id, project_id, version_type, inputs_json,
                    prompt_metadata_json, metadata_json, created_at
                ) VALUES ('orphan', 'missing', 'create', '{}', '{}', '{}', ?)
                """,
                (datetime.now(timezone.utc).isoformat(),),
            )
    finally:
        conn.close()

    store = HistoryStore(database_path)
    store.save_project_snapshot("one", _snapshot(_version("one-root")))
    store.save_project_snapshot("two", _snapshot(_version("two-root")))

    with pytest.raises(HistoryValidationError, match="same project"):
        store.append_version(
            "two",
            _version("bad-child", parent_id="one-root"),
        )


def test_append_history_is_idempotent_and_immutable(database_path: Path) -> None:
    times = iter(
        [
            datetime(2026, 1, 1, tzinfo=timezone.utc),
            datetime(2026, 1, 2, tzinfo=timezone.utc),
            datetime(2026, 1, 3, tzinfo=timezone.utc),
        ]
    )
    store = HistoryStore(database_path, clock=lambda: next(times))
    root = _version("root")

    first = store.save_project_snapshot("project", _snapshot(root))
    first_updated_at = first.updated_at
    repeated = store.append_version(
        "project",
        root,
        selected_variant_index=0,
    )

    assert repeated.commit_count == 1
    assert repeated.variant_count == 1
    assert repeated.updated_at == first_updated_at

    changed = root.model_copy(
        update={"variants": [root.variants[0].model_copy(update={"code": "changed"})]}
    )
    with pytest.raises(HistoryConflictError, match="different variant data"):
        store.append_version("project", changed, selected_variant_index=0)

    conn = open_history_db(database_path)
    try:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            conn.execute("UPDATE commits SET version_type = 'update' WHERE id = 'root'")
    finally:
        conn.close()


def test_retry_creates_a_descendant_and_preserves_source(database_path: Path) -> None:
    store = HistoryStore(database_path)
    store.save_project_snapshot("project", _snapshot(_version("root")))
    retry = _version(
        "retry-1",
        parent_id="root",
        retry_of_id="root",
        version_type="retry",
        code="<main>retry</main>",
    )

    history = store.append_version(
        "project",
        retry,
        selected_variant_index=0,
    )

    commits = {commit.id: commit for commit in history.commits}
    assert set(commits) == {"root", "retry-1"}
    root = commits["root"]
    retry_record = commits["retry-1"]
    assert root.child_commit_ids == ["retry-1"]
    assert retry_record.parent_commit_id == "root"
    assert retry_record.retry_of_commit_id == "root"
    assert retry_record.version_type == "retry"
    assert root.variants[0].code == "<main>first</main>"
    assert retry_record.variants[0].code == "<main>retry</main>"
    assert retry_record.prompts[0].id == "shared-prompt-id"
    assert retry_record.variants[0].messages[0].id == "shared-message-id"

    failed_retry = _version(
        "retry-2",
        parent_id="root",
        retry_of_id="root",
        version_type="retry",
        code="<main>partial retry</main>",
    )
    failed_retry = failed_retry.model_copy(
        update={
            "variants": [
                failed_retry.variants[0].model_copy(
                    update={"status": "failed", "error": "provider unavailable"}
                )
            ]
        }
    )
    repeated = store.append_version(
        "project",
        failed_retry,
        selected_variant_index=0,
    )
    repeated_commits = {commit.id: commit for commit in repeated.commits}

    assert set(repeated_commits) == {"root", "retry-1", "retry-2"}
    assert repeated_commits["root"].child_commit_ids == ["retry-1", "retry-2"]
    assert repeated_commits["retry-2"].parent_commit_id == "root"
    assert repeated_commits["retry-2"].retry_of_commit_id == "root"
    assert repeated_commits["retry-2"].variants[0].status == "failed"
    assert repeated_commits["retry-2"].variants[0].error == "provider unavailable"
    assert repeated_commits["root"].variants[0].code == "<main>first</main>"

    with pytest.raises(ValidationError, match="retryOfCommitId"):
        VersionInput(id="invalid-retry", version_type="retry")


def test_selection_updates_validate_commit_and_variant(database_path: Path) -> None:
    store = HistoryStore(database_path)
    store.save_project_snapshot("project", _snapshot(_version("root")))
    store.append_version(
        "project",
        _version("child", parent_id="root", variant_index=1),
        selected_variant_index=1,
    )

    history = store.update_selection(
        "project",
        SelectionUpdateRequest(
            head_commit_id="child",
            selected_commit_id="root",
            selected_variant_index=0,
        ),
    )
    assert history.head_commit_id == "child"
    assert history.selected_commit_id == "root"
    assert history.selected_variant_index == 0

    cleared = store.update_selection(
        "project",
        SelectionUpdateRequest(selected_commit_id=None),
    )
    assert cleared.selected_commit_id is None
    assert cleared.selected_variant_index is None

    with pytest.raises(HistoryValidationError, match="Selected variant"):
        store.update_selection(
            "project",
            SelectionUpdateRequest(
                selected_commit_id="root",
                selected_variant_index=99,
            ),
        )


def test_projects_are_listed_by_most_recent_update(database_path: Path) -> None:
    base = datetime(2026, 2, 1, tzinfo=timezone.utc)
    times = iter([base, base + timedelta(minutes=1), base + timedelta(minutes=2)])
    store = HistoryStore(database_path, clock=lambda: next(times))

    store.save_project_snapshot("project-1", ProjectSnapshotRequest(title="One"))
    store.save_project_snapshot("project-2", ProjectSnapshotRequest(title="Two"))
    store.save_project_snapshot(
        "project-1",
        ProjectSnapshotRequest(title="One updated"),
    )

    projects = store.list_projects()
    assert [project.id for project in projects] == ["project-1", "project-2"]
    assert projects[0].title == "One updated"


def test_delete_project_cascades_all_history(database_path: Path) -> None:
    store = HistoryStore(database_path)
    store.save_project_snapshot("project", _snapshot(_version("root")))
    store.append_version(
        "project",
        _version(
            "retry",
            parent_id="root",
            retry_of_id="root",
            version_type="retry",
        ),
        selected_variant_index=0,
    )

    assert _counts(database_path) == {
        "projects": 1,
        "commits": 2,
        "variants": 2,
        "prompts": 2,
        "variant_messages": 4,
    }

    store.delete_project("project")

    assert _counts(database_path) == {
        "projects": 0,
        "commits": 0,
        "variants": 0,
        "prompts": 0,
        "variant_messages": 0,
    }


def test_malformed_json_and_input_are_rejected(database_path: Path) -> None:
    with pytest.raises(HistoryValidationError, match="valid JSON"):
        encode_json(
            {"notFinite": float("nan")},
            field_name="metadata",
            expected_type="object",
        )

    with pytest.raises(ValidationError):
        ProjectSnapshotRequest.model_validate(
            {"title": "Invalid", "metadata": ["not", "an", "object"]}
        )

    conn = open_history_db(database_path)
    try:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO projects(
                    id, title, metadata_json, created_at, updated_at
                ) VALUES ('invalid', 'Invalid', 'not-json', ?, ?)
                """,
                (
                    datetime.now(timezone.utc).isoformat(),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
    finally:
        conn.close()

    store = HistoryStore(database_path)
    store.save_project_snapshot("project", ProjectSnapshotRequest(title="Valid"))
    raw = sqlite3.connect(database_path)
    try:
        raw.execute("PRAGMA ignore_check_constraints = ON")
        raw.execute(
            "UPDATE projects SET metadata_json = 'not-json' WHERE id = 'project'"
        )
        raw.commit()
    finally:
        raw.close()

    with pytest.raises(HistoryDataError, match="not valid JSON"):
        store.get_project("project")


def test_append_is_atomic_when_nested_insert_conflicts(database_path: Path) -> None:
    store = HistoryStore(database_path)
    store.save_project_snapshot("project", ProjectSnapshotRequest(title="Atomic"))
    duplicate_prompts = [
        PromptInput(id="duplicate", content="first"),
        PromptInput(id="duplicate", content="second"),
    ]
    invalid_version = VersionInput.model_construct(
        id="partial",
        commit_hash=None,
        parent_commit_id=None,
        retry_of_commit_id=None,
        version_type="create",
        inputs={},
        prompt_metadata={},
        metadata={},
        created_at=None,
        prompts=duplicate_prompts,
        variants=[],
    )

    with pytest.raises(HistoryConflictError):
        store.append_version("project", invalid_version)

    assert _counts(database_path) == {
        "projects": 1,
        "commits": 0,
        "variants": 0,
        "prompts": 0,
        "variant_messages": 0,
    }


def test_database_persists_across_connections(database_path: Path) -> None:
    first_store = HistoryStore(database_path)
    first_store.save_project_snapshot("project", _snapshot(_version("root")))

    second_store = HistoryStore(database_path)
    history = second_store.get_project("project")

    assert database_path.is_file()
    assert history.title == "Landing page"
    assert history.commits[0].variants[0].code == "<main>first</main>"
    assert second_store.health().foreign_keys_enabled is True
    assert second_store.health().journal_mode.lower() == "wal"


def test_history_api_contract_and_errors(database_path: Path) -> None:
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    payload: dict[str, Any] = {
        "title": "API project",
        "stack": "html_tailwind",
        "input_mode": "image",
        "selected_variant_index": 0,
        "version": {
            "id": "root",
            "commit_hash": "hash-root",
            "version_type": "create",
            "inputs": {"mode": "image"},
            "prompts": [{"content": {"text": "Build it"}}],
            "variants": [
                {
                    "index": 0,
                    "model": "test-model",
                    "status": "completed",
                    "code": "<main>api</main>",
                    "messages": [
                        {
                            "role": "user",
                            "content": "Refine it",
                            "media": [{"type": "image", "url": "local://one"}],
                        }
                    ],
                }
            ],
        },
    }

    created = client.put("/api/history/projects/api-project", json=payload)
    assert created.status_code == 200
    created_body = created.json()
    assert created_body["head_commit_id"] == "root"
    assert created_body["selected_variant_index"] == 0
    assert created_body["commits"][0]["variants"][0]["messages"][0]["media"]

    listed = client.get("/api/history/projects")
    assert listed.status_code == 200
    assert listed.json()["projects"][0]["id"] == "api-project"

    fetched = client.get("/api/history/projects/api-project")
    assert fetched.status_code == 200
    assert fetched.json()["root_commit_ids"] == ["root"]

    appended = client.post(
        "/api/history/projects/api-project/versions",
        json={
            "version": {
                "id": "retry",
                "parent_commit_id": "root",
                "retry_of_commit_id": "root",
                "version_type": "retry",
                "variants": [{"index": 1, "status": "failed", "error": "boom"}],
            },
            "selected_variant_index": 1,
        },
    )
    assert appended.status_code == 200
    assert appended.json()["head_commit_id"] == "retry"
    assert len(appended.json()["commits"]) == 2

    selected = client.patch(
        "/api/history/projects/api-project/selection",
        json={
            "head_commit_id": "retry",
            "selected_commit_id": "root",
            "selected_variant_index": 0,
        },
    )
    assert selected.status_code == 200
    assert selected.json()["selected_commit_id"] == "root"
    assert selected.json()["selected_variant_index"] == 0

    health = client.get("/api/history/health")
    assert health.status_code == 200
    assert health.json()["schema_version"] == LATEST_SCHEMA_VERSION

    invalid = client.put(
        "/api/history/projects/invalid",
        json={"title": "Invalid", "metadata": []},
    )
    assert invalid.status_code == 422

    conflict_payload = payload | {
        "version": payload["version"] | {
            "variants": [
                {
                    "index": 0,
                    "status": "completed",
                    "code": "different",
                }
            ]
        }
    }
    conflict = client.put(
        "/api/history/projects/api-project",
        json=conflict_payload,
    )
    assert conflict.status_code == 409

    missing = client.get("/api/history/projects/missing")
    assert missing.status_code == 404

    deleted = client.delete("/api/history/projects/api-project")
    assert deleted.status_code == 204
    assert client.get("/api/history/projects/api-project").status_code == 404
