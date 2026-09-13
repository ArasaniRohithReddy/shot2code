"""Desktop-local SQLite storage primitives for project history."""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal, cast

HISTORY_DB_FILENAME = "history.sqlite3"
HISTORY_DB_PATH_ENV = "SHOT2CODE_HISTORY_DB_PATH"
DATA_DIR_ENV = "SHOT2CODE_DATA_DIR"
LATEST_SCHEMA_VERSION = 2


class HistoryError(Exception):
    """Base class for history persistence failures."""


class HistoryNotFoundError(HistoryError):
    """Raised when a requested history record does not exist."""


class HistoryConflictError(HistoryError):
    """Raised when an immutable record conflicts with stored history."""


class HistoryValidationError(HistoryError):
    """Raised when input cannot be represented safely in the history database."""


class HistoryDataError(HistoryError):
    """Raised when persisted data is malformed or inconsistent."""


def get_history_data_directory() -> Path:
    """Return the persistent shot2code data directory for this platform."""

    configured = os.environ.get(DATA_DIR_ENV)
    if configured:
        return Path(configured).expanduser()

    if sys.platform == "win32":
        local_app_data = os.environ.get("LOCALAPPDATA")
        base = (
            Path(local_app_data).expanduser()
            if local_app_data
            else Path.home() / "AppData" / "Local"
        )
        return base / "shot2code"

    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "shot2code"

    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    base = (
        Path(xdg_data_home).expanduser()
        if xdg_data_home
        else Path.home() / ".local" / "share"
    )
    return base / "shot2code"


def get_history_db_path() -> Path:
    """Return the configured history database file path."""

    configured = os.environ.get(HISTORY_DB_PATH_ENV)
    if configured:
        return Path(configured).expanduser()
    return get_history_data_directory() / HISTORY_DB_FILENAME


def encode_json(
    value: Any,
    *,
    field_name: str,
    expected_type: Literal["object", "array", "any"] = "any",
) -> str:
    """Serialize a JSON value canonically and reject non-JSON Python values."""

    try:
        encoded = json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        decoded = json.loads(encoded)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HistoryValidationError(
            f"{field_name} must contain only valid JSON values"
        ) from exc

    if expected_type == "object" and not isinstance(decoded, dict):
        raise HistoryValidationError(f"{field_name} must be a JSON object")
    if expected_type == "array" and not isinstance(decoded, list):
        raise HistoryValidationError(f"{field_name} must be a JSON array")
    return encoded


def decode_json(
    raw_value: str,
    *,
    field_name: str,
    expected_type: Literal["object", "array", "any"] = "any",
) -> Any:
    """Decode and validate JSON read from SQLite."""

    try:
        decoded: Any = json.loads(raw_value)
    except (TypeError, json.JSONDecodeError) as exc:
        raise HistoryDataError(f"Stored {field_name} is not valid JSON") from exc

    if expected_type == "object" and not isinstance(decoded, dict):
        raise HistoryDataError(f"Stored {field_name} must be a JSON object")
    if expected_type == "array" and not isinstance(decoded, list):
        raise HistoryDataError(f"Stored {field_name} must be a JSON array")
    return cast(Any, decoded)


def _migration_1(conn: sqlite3.Connection) -> None:
    statements = (
        """
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
            title TEXT NOT NULL CHECK (length(trim(title)) > 0),
            stack TEXT,
            input_mode TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            head_commit_id TEXT,
            selected_commit_id TEXT,
            selected_variant_index INTEGER CHECK (
                selected_variant_index IS NULL OR selected_variant_index >= 0
            ),
            CHECK (selected_variant_index IS NULL OR selected_commit_id IS NOT NULL)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS commits (
            id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
            commit_hash TEXT,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            parent_commit_id TEXT REFERENCES commits(id) ON DELETE CASCADE,
            retry_of_commit_id TEXT REFERENCES commits(id) ON DELETE CASCADE,
            version_type TEXT NOT NULL CHECK (length(trim(version_type)) > 0),
            inputs_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(inputs_json) AND json_type(inputs_json) = 'object'),
            prompt_metadata_json TEXT NOT NULL DEFAULT '{}'
                CHECK (
                    json_valid(prompt_metadata_json)
                    AND json_type(prompt_metadata_json) = 'object'
                ),
            metadata_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
            created_at TEXT NOT NULL,
            CHECK (parent_commit_id IS NULL OR parent_commit_id <> id),
            CHECK (retry_of_commit_id IS NULL OR retry_of_commit_id <> id),
            CHECK (lower(version_type) <> 'retry' OR retry_of_commit_id IS NOT NULL)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS variants (
            commit_id TEXT NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
            variant_index INTEGER NOT NULL CHECK (variant_index >= 0),
            model TEXT,
            status TEXT NOT NULL CHECK (length(trim(status)) > 0),
            code TEXT,
            current_content TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
            error TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
            PRIMARY KEY (commit_id, variant_index)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS prompts (
            id TEXT NOT NULL CHECK (length(trim(id)) > 0),
            commit_id TEXT NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
            position INTEGER NOT NULL CHECK (position >= 0),
            role TEXT NOT NULL CHECK (length(trim(role)) > 0),
            kind TEXT NOT NULL CHECK (length(trim(kind)) > 0),
            content_json TEXT NOT NULL CHECK (json_valid(content_json)),
            metadata_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
            created_at TEXT NOT NULL,
            PRIMARY KEY (commit_id, id),
            UNIQUE (commit_id, position)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS variant_messages (
            id TEXT NOT NULL CHECK (length(trim(id)) > 0),
            commit_id TEXT NOT NULL,
            variant_index INTEGER NOT NULL,
            position INTEGER NOT NULL CHECK (position >= 0),
            role TEXT NOT NULL CHECK (length(trim(role)) > 0),
            content TEXT,
            media_json TEXT NOT NULL DEFAULT '[]'
                CHECK (json_valid(media_json) AND json_type(media_json) = 'array'),
            metadata_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
            created_at TEXT NOT NULL,
            PRIMARY KEY (commit_id, variant_index, id),
            FOREIGN KEY (commit_id, variant_index)
                REFERENCES variants(commit_id, variant_index) ON DELETE CASCADE,
            UNIQUE (commit_id, variant_index, position)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_projects_recent ON projects(updated_at DESC, id)",
        "CREATE INDEX IF NOT EXISTS idx_commits_project ON commits(project_id, created_at, id)",
        "CREATE INDEX IF NOT EXISTS idx_commits_parent ON commits(parent_commit_id)",
        "CREATE INDEX IF NOT EXISTS idx_commits_retry ON commits(retry_of_commit_id)",
        "CREATE INDEX IF NOT EXISTS idx_variants_commit ON variants(commit_id, variant_index)",
        "CREATE INDEX IF NOT EXISTS idx_prompts_commit ON prompts(commit_id, position)",
        """
        CREATE INDEX IF NOT EXISTS idx_messages_variant
        ON variant_messages(commit_id, variant_index, position)
        """,
    )
    for statement in statements:
        conn.execute(statement)


def _migration_2(conn: sqlite3.Connection) -> None:
    statements = (
        """
        CREATE TRIGGER IF NOT EXISTS commits_parent_project_guard
        BEFORE INSERT ON commits
        WHEN NEW.parent_commit_id IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM commits parent
                 WHERE parent.id = NEW.parent_commit_id
                   AND parent.project_id = NEW.project_id
             )
        BEGIN
            SELECT RAISE(ABORT, 'parent commit must belong to the same project');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS commits_retry_project_guard
        BEFORE INSERT ON commits
        WHEN NEW.retry_of_commit_id IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM commits source
                 WHERE source.id = NEW.retry_of_commit_id
                   AND source.project_id = NEW.project_id
             )
        BEGIN
            SELECT RAISE(ABORT, 'retry source must belong to the same project');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS projects_selection_insert_guard
        BEFORE INSERT ON projects
        WHEN NEW.head_commit_id IS NOT NULL
             OR NEW.selected_commit_id IS NOT NULL
             OR NEW.selected_variant_index IS NOT NULL
        BEGIN
            SELECT RAISE(ABORT, 'new projects cannot select history before it exists');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS projects_selection_update_guard
        BEFORE UPDATE OF head_commit_id, selected_commit_id, selected_variant_index
        ON projects
        BEGIN
            SELECT CASE
                WHEN NEW.head_commit_id IS NOT NULL
                     AND NOT EXISTS (
                         SELECT 1 FROM commits
                         WHERE id = NEW.head_commit_id AND project_id = NEW.id
                     )
                THEN RAISE(ABORT, 'head commit must belong to the project')
            END;
            SELECT CASE
                WHEN NEW.selected_commit_id IS NOT NULL
                     AND NOT EXISTS (
                         SELECT 1 FROM commits
                         WHERE id = NEW.selected_commit_id AND project_id = NEW.id
                     )
                THEN RAISE(ABORT, 'selected commit must belong to the project')
            END;
            SELECT CASE
                WHEN NEW.selected_variant_index IS NOT NULL
                     AND (
                         NEW.selected_commit_id IS NULL
                         OR NOT EXISTS (
                             SELECT 1 FROM variants
                             WHERE commit_id = NEW.selected_commit_id
                               AND variant_index = NEW.selected_variant_index
                         )
                     )
                THEN RAISE(ABORT, 'selected variant must belong to the selected commit')
            END;
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS commits_append_only_update
        BEFORE UPDATE ON commits
        BEGIN
            SELECT RAISE(ABORT, 'commits are append-only');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS commits_append_only_delete
        BEFORE DELETE ON commits
        WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
        BEGIN
            SELECT RAISE(ABORT, 'commits are append-only');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS variants_append_only_update
        BEFORE UPDATE ON variants
        BEGIN
            SELECT RAISE(ABORT, 'variants are append-only');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS variants_append_only_delete
        BEFORE DELETE ON variants
        WHEN EXISTS (SELECT 1 FROM commits WHERE id = OLD.commit_id)
        BEGIN
            SELECT RAISE(ABORT, 'variants are append-only');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS prompts_append_only_update
        BEFORE UPDATE ON prompts
        BEGIN
            SELECT RAISE(ABORT, 'prompts are append-only');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS prompts_append_only_delete
        BEFORE DELETE ON prompts
        WHEN EXISTS (SELECT 1 FROM commits WHERE id = OLD.commit_id)
        BEGIN
            SELECT RAISE(ABORT, 'prompts are append-only');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS messages_append_only_update
        BEFORE UPDATE ON variant_messages
        BEGIN
            SELECT RAISE(ABORT, 'variant messages are append-only');
        END
        """,
        """
        CREATE TRIGGER IF NOT EXISTS messages_append_only_delete
        BEFORE DELETE ON variant_messages
        WHEN EXISTS (
            SELECT 1 FROM variants
            WHERE commit_id = OLD.commit_id AND variant_index = OLD.variant_index
        )
        BEGIN
            SELECT RAISE(ABORT, 'variant messages are append-only');
        END
        """,
    )
    for statement in statements:
        conn.execute(statement)


_MIGRATIONS = (
    (1, "initial_history_schema", _migration_1),
    (2, "append_only_and_selection_guards", _migration_2),
)


def apply_migrations(conn: sqlite3.Connection) -> None:
    """Apply every unapplied migration in one transaction."""

    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
            """
        )
        current_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        applied = {
            int(row[0])
            for row in conn.execute("SELECT version FROM schema_migrations")
        }
        if current_version > LATEST_SCHEMA_VERSION or any(
            version > LATEST_SCHEMA_VERSION for version in applied
        ):
            raise HistoryDataError(
                "History database schema is newer than this backend supports"
            )
        for version, name, migration in _MIGRATIONS:
            if version in applied:
                continue
            migration(conn)
            conn.execute(
                "INSERT INTO schema_migrations(version, name) VALUES (?, ?)",
                (version, name),
            )
        conn.execute(f"PRAGMA user_version = {LATEST_SCHEMA_VERSION}")
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def open_history_db(database_path: Path | str | None = None) -> sqlite3.Connection:
    """Open a configured SQLite connection and ensure the schema is current."""

    path = Path(database_path).expanduser() if database_path else get_history_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA foreign_keys = ON")
        apply_migrations(conn)
        return conn
    except Exception:
        conn.close()
        raise


@contextmanager
def history_connection(
    database_path: Path | str | None = None,
) -> Iterator[sqlite3.Connection]:
    conn = open_history_db(database_path)
    try:
        yield conn
    finally:
        conn.close()
