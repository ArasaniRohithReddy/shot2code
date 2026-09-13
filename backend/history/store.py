"""Transactional repository for immutable project history."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

from history.database import (
    LATEST_SCHEMA_VERSION,
    HistoryConflictError,
    HistoryDataError,
    HistoryNotFoundError,
    HistoryValidationError,
    decode_json,
    encode_json,
    get_history_db_path,
    open_history_db,
)
from history.models import (
    CommitRecord,
    HistoryHealthResponse,
    HistoryMessageInput,
    HistoryMessageRecord,
    MigrationRecord,
    ProjectHistory,
    ProjectSnapshotRequest,
    ProjectSummary,
    PromptInput,
    PromptRecord,
    SelectionUpdateRequest,
    VariantInput,
    VariantRecord,
    VersionInput,
)

Clock = Callable[[], datetime]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _format_timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise HistoryValidationError("timestamps must include a timezone")
    return (
        value.astimezone(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _parse_timestamp(value: str, field_name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise HistoryDataError(f"Stored {field_name} is not a valid timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise HistoryDataError(f"Stored {field_name} must include a timezone")
    return parsed


def _optional_timestamp(value: str | None, field_name: str) -> datetime | None:
    return _parse_timestamp(value, field_name) if value is not None else None


def _json_object(raw_value: str, field_name: str) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        decode_json(raw_value, field_name=field_name, expected_type="object"),
    )


def _json_array(raw_value: str, field_name: str) -> list[Any]:
    return cast(
        list[Any],
        decode_json(raw_value, field_name=field_name, expected_type="array"),
    )


class HistoryStore:
    """Persist projects and append-only version trees in SQLite."""

    def __init__(
        self,
        database_path: Path | str | None = None,
        *,
        clock: Clock = _utc_now,
    ) -> None:
        self.database_path = (
            Path(database_path).expanduser()
            if database_path is not None
            else get_history_db_path()
        )
        self._clock = clock

    def _now(self) -> str:
        return _format_timestamp(self._clock())

    @contextmanager
    def _read_connection(self) -> Iterator[sqlite3.Connection]:
        conn = open_history_db(self.database_path)
        try:
            yield conn
        finally:
            conn.close()

    @contextmanager
    def _write_connection(self) -> Iterator[sqlite3.Connection]:
        conn = open_history_db(self.database_path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            raise HistoryConflictError(str(exc)) from exc
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def list_projects(self, *, limit: int = 100, offset: int = 0) -> list[ProjectSummary]:
        if limit < 1 or limit > 500:
            raise HistoryValidationError("limit must be between 1 and 500")
        if offset < 0:
            raise HistoryValidationError("offset must be non-negative")

        with self._read_connection() as conn:
            rows = conn.execute(
                """
                SELECT p.*,
                       (SELECT COUNT(*) FROM commits c WHERE c.project_id = p.id)
                           AS commit_count,
                       (
                           SELECT COUNT(*)
                           FROM variants v
                           JOIN commits c ON c.id = v.commit_id
                           WHERE c.project_id = p.id
                       ) AS variant_count
                FROM projects p
                ORDER BY p.updated_at DESC, p.id DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()
            return [self._project_summary(row) for row in rows]

    def get_project(self, project_id: str) -> ProjectHistory:
        with self._read_connection() as conn:
            return self._load_project(conn, project_id)

    def save_project_snapshot(
        self,
        project_id: str,
        request: ProjectSnapshotRequest,
    ) -> ProjectHistory:
        now = self._now()
        project_metadata_json = encode_json(
            request.metadata,
            field_name="project metadata",
            expected_type="object",
        )

        with self._write_connection() as conn:
            project_row = conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            changed = False

            if project_row is None:
                created_at = (
                    _format_timestamp(request.created_at)
                    if request.created_at is not None
                    else now
                )
                conn.execute(
                    """
                    INSERT INTO projects(
                        id, title, stack, input_mode, metadata_json,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        project_id,
                        request.title,
                        request.stack,
                        request.input_mode,
                        project_metadata_json,
                        created_at,
                        now,
                    ),
                )
                project_row = conn.execute(
                    "SELECT * FROM projects WHERE id = ?", (project_id,)
                ).fetchone()
                changed = True
            else:
                project_changed = (
                    project_row["title"] != request.title
                    or project_row["stack"] != request.stack
                    or project_row["input_mode"] != request.input_mode
                    or project_row["metadata_json"] != project_metadata_json
                )
                if project_changed:
                    conn.execute(
                        """
                        UPDATE projects
                        SET title = ?, stack = ?, input_mode = ?, metadata_json = ?
                        WHERE id = ?
                        """,
                        (
                            request.title,
                            request.stack,
                            request.input_mode,
                            project_metadata_json,
                            project_id,
                        ),
                    )
                    changed = True

            if project_row is None:
                raise HistoryDataError("Project insert did not produce a row")

            if request.version is not None:
                inserted = self._append_version(
                    conn,
                    project_id,
                    request.version,
                    now,
                )
                changed = changed or inserted
                selection_changed = self._apply_selection(
                    conn,
                    project_row,
                    update_head=request.set_as_head,
                    head_commit_id=request.version.id,
                    update_selected=request.select_commit,
                    selected_commit_id=request.version.id,
                    update_variant=request.select_commit,
                    selected_variant_index=request.selected_variant_index,
                )
                changed = changed or selection_changed

            if changed:
                conn.execute(
                    "UPDATE projects SET updated_at = ? WHERE id = ?",
                    (now, project_id),
                )
            return self._load_project(conn, project_id)

    def append_version(
        self,
        project_id: str,
        version: VersionInput,
        *,
        set_as_head: bool = True,
        select_commit: bool = True,
        selected_variant_index: int | None = None,
    ) -> ProjectHistory:
        if not select_commit and selected_variant_index is not None:
            raise HistoryValidationError(
                "selected_variant_index requires select_commit"
            )

        now = self._now()
        with self._write_connection() as conn:
            project_row = conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if project_row is None:
                raise HistoryNotFoundError("Project not found")

            inserted = self._append_version(conn, project_id, version, now)
            selection_changed = self._apply_selection(
                conn,
                project_row,
                update_head=set_as_head,
                head_commit_id=version.id,
                update_selected=select_commit,
                selected_commit_id=version.id,
                update_variant=select_commit,
                selected_variant_index=selected_variant_index,
            )
            if inserted or selection_changed:
                conn.execute(
                    "UPDATE projects SET updated_at = ? WHERE id = ?",
                    (now, project_id),
                )
            return self._load_project(conn, project_id)

    def update_selection(
        self,
        project_id: str,
        request: SelectionUpdateRequest,
    ) -> ProjectHistory:
        fields = request.model_fields_set
        update_head = "head_commit_id" in fields
        update_selected = "selected_commit_id" in fields
        update_variant = "selected_variant_index" in fields
        if not (update_head or update_selected or update_variant):
            raise HistoryValidationError("At least one selection field is required")

        now = self._now()
        with self._write_connection() as conn:
            project_row = conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if project_row is None:
                raise HistoryNotFoundError("Project not found")

            changed = self._apply_selection(
                conn,
                project_row,
                update_head=update_head,
                head_commit_id=request.head_commit_id,
                update_selected=update_selected,
                selected_commit_id=request.selected_commit_id,
                update_variant=update_variant,
                selected_variant_index=request.selected_variant_index,
            )
            if changed:
                conn.execute(
                    "UPDATE projects SET updated_at = ? WHERE id = ?",
                    (now, project_id),
                )
            return self._load_project(conn, project_id)

    def delete_project(self, project_id: str) -> None:
        with self._write_connection() as conn:
            cursor = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            if cursor.rowcount == 0:
                raise HistoryNotFoundError("Project not found")

    def health(self) -> HistoryHealthResponse:
        with self._read_connection() as conn:
            schema_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
            foreign_keys_enabled = bool(
                conn.execute("PRAGMA foreign_keys").fetchone()[0]
            )
            journal_mode = str(conn.execute("PRAGMA journal_mode").fetchone()[0])
            migration_rows = conn.execute(
                "SELECT version, name, applied_at FROM schema_migrations ORDER BY version"
            ).fetchall()
            migrations = [
                MigrationRecord(
                    version=int(row["version"]),
                    name=str(row["name"]),
                    applied_at=_parse_timestamp(
                        str(row["applied_at"]), "migration applied_at"
                    ),
                )
                for row in migration_rows
            ]
            return HistoryHealthResponse(
                status="ok",
                database_path=str(self.database_path),
                schema_version=schema_version,
                latest_schema_version=LATEST_SCHEMA_VERSION,
                foreign_keys_enabled=foreign_keys_enabled,
                journal_mode=journal_mode,
                migrations=migrations,
            )

    def _append_version(
        self,
        conn: sqlite3.Connection,
        project_id: str,
        version: VersionInput,
        now: str,
    ) -> bool:
        existing = conn.execute(
            "SELECT * FROM commits WHERE id = ?", (version.id,)
        ).fetchone()
        if existing is not None:
            self._assert_version_matches(conn, project_id, version, existing)
            return False

        self._validate_link(conn, project_id, version.parent_commit_id, "parent commit")
        self._validate_link(
            conn,
            project_id,
            version.retry_of_commit_id,
            "retry source",
        )

        inputs_json = encode_json(
            version.inputs,
            field_name="version inputs",
            expected_type="object",
        )
        prompt_metadata_json = encode_json(
            version.prompt_metadata,
            field_name="prompt metadata",
            expected_type="object",
        )
        metadata_json = encode_json(
            version.metadata,
            field_name="version metadata",
            expected_type="object",
        )
        created_at = (
            _format_timestamp(version.created_at)
            if version.created_at is not None
            else now
        )

        conn.execute(
            """
            INSERT INTO commits(
                id, commit_hash, project_id, parent_commit_id, retry_of_commit_id,
                version_type, inputs_json, prompt_metadata_json, metadata_json,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                version.id,
                version.commit_hash,
                project_id,
                version.parent_commit_id,
                version.retry_of_commit_id,
                version.version_type,
                inputs_json,
                prompt_metadata_json,
                metadata_json,
                created_at,
            ),
        )

        for position, prompt in enumerate(version.prompts):
            self._insert_prompt(conn, version.id, prompt, position, now)
        for variant in version.variants:
            self._insert_variant(conn, version.id, variant, now)
        return True

    def _insert_prompt(
        self,
        conn: sqlite3.Connection,
        commit_id: str,
        prompt: PromptInput,
        position: int,
        now: str,
    ) -> None:
        prompt_id = prompt.id or f"{commit_id}:prompt:{position}"
        content_json = encode_json(prompt.content, field_name="prompt content")
        metadata_json = encode_json(
            prompt.metadata,
            field_name="prompt metadata",
            expected_type="object",
        )
        created_at = (
            _format_timestamp(prompt.created_at)
            if prompt.created_at is not None
            else now
        )
        conn.execute(
            """
            INSERT INTO prompts(
                id, commit_id, position, role, kind, content_json,
                metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                prompt_id,
                commit_id,
                position,
                prompt.role,
                prompt.kind,
                content_json,
                metadata_json,
                created_at,
            ),
        )

    def _insert_variant(
        self,
        conn: sqlite3.Connection,
        commit_id: str,
        variant: VariantInput,
        now: str,
    ) -> None:
        metadata_json = encode_json(
            variant.metadata,
            field_name="variant metadata",
            expected_type="object",
        )
        created_at = (
            _format_timestamp(variant.created_at)
            if variant.created_at is not None
            else now
        )
        conn.execute(
            """
            INSERT INTO variants(
                commit_id, variant_index, model, status, code, current_content,
                created_at, started_at, completed_at, duration_ms, error,
                metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                commit_id,
                variant.index,
                variant.model,
                variant.status,
                variant.code,
                variant.current_content,
                created_at,
                _format_timestamp(variant.started_at)
                if variant.started_at is not None
                else None,
                _format_timestamp(variant.completed_at)
                if variant.completed_at is not None
                else None,
                variant.duration_ms,
                variant.error,
                metadata_json,
            ),
        )
        for position, message in enumerate(variant.messages):
            self._insert_message(
                conn,
                commit_id,
                variant.index,
                message,
                position,
                now,
            )

    def _insert_message(
        self,
        conn: sqlite3.Connection,
        commit_id: str,
        variant_index: int,
        message: HistoryMessageInput,
        position: int,
        now: str,
    ) -> None:
        message_id = message.id or f"{commit_id}:{variant_index}:message:{position}"
        media_json = encode_json(
            message.media,
            field_name="message media",
            expected_type="array",
        )
        metadata_json = encode_json(
            message.metadata,
            field_name="message metadata",
            expected_type="object",
        )
        created_at = (
            _format_timestamp(message.created_at)
            if message.created_at is not None
            else now
        )
        conn.execute(
            """
            INSERT INTO variant_messages(
                id, commit_id, variant_index, position, role, content,
                media_json, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                message_id,
                commit_id,
                variant_index,
                position,
                message.role,
                message.content,
                media_json,
                metadata_json,
                created_at,
            ),
        )

    def _assert_version_matches(
        self,
        conn: sqlite3.Connection,
        project_id: str,
        version: VersionInput,
        existing: sqlite3.Row,
    ) -> None:
        scalar_values: dict[str, Any] = {
            "project_id": project_id,
            "commit_hash": version.commit_hash,
            "parent_commit_id": version.parent_commit_id,
            "retry_of_commit_id": version.retry_of_commit_id,
            "version_type": version.version_type,
            "inputs_json": encode_json(
                version.inputs,
                field_name="version inputs",
                expected_type="object",
            ),
            "prompt_metadata_json": encode_json(
                version.prompt_metadata,
                field_name="prompt metadata",
                expected_type="object",
            ),
            "metadata_json": encode_json(
                version.metadata,
                field_name="version metadata",
                expected_type="object",
            ),
        }
        for column, expected in scalar_values.items():
            if existing[column] != expected:
                raise HistoryConflictError(
                    f"Version {version.id} already exists with different {column}"
                )
        if (
            version.created_at is not None
            and existing["created_at"] != _format_timestamp(version.created_at)
        ):
            raise HistoryConflictError(
                f"Version {version.id} already exists with a different created_at"
            )

        prompt_rows = conn.execute(
            "SELECT * FROM prompts WHERE commit_id = ? ORDER BY position",
            (version.id,),
        ).fetchall()
        if len(prompt_rows) != len(version.prompts):
            raise HistoryConflictError(
                f"Version {version.id} already exists with different prompts"
            )
        for position, (prompt, row) in enumerate(zip(version.prompts, prompt_rows)):
            expected: dict[str, Any] = {
                "id": prompt.id or f"{version.id}:prompt:{position}",
                "position": position,
                "role": prompt.role,
                "kind": prompt.kind,
                "content_json": encode_json(
                    prompt.content,
                    field_name="prompt content",
                ),
                "metadata_json": encode_json(
                    prompt.metadata,
                    field_name="prompt metadata",
                    expected_type="object",
                ),
            }
            self._assert_row_matches(version.id, "prompt", row, expected)
            if (
                prompt.created_at is not None
                and row["created_at"] != _format_timestamp(prompt.created_at)
            ):
                raise HistoryConflictError(
                    f"Version {version.id} already exists with different prompt timestamps"
                )

        variant_rows = conn.execute(
            "SELECT * FROM variants WHERE commit_id = ? ORDER BY variant_index",
            (version.id,),
        ).fetchall()
        sorted_variants = sorted(version.variants, key=lambda item: item.index)
        if len(variant_rows) != len(sorted_variants):
            raise HistoryConflictError(
                f"Version {version.id} already exists with different variants"
            )
        for variant, row in zip(sorted_variants, variant_rows):
            expected_variant: dict[str, Any] = {
                "variant_index": variant.index,
                "model": variant.model,
                "status": variant.status,
                "code": variant.code,
                "current_content": variant.current_content,
                "started_at": _format_timestamp(variant.started_at)
                if variant.started_at is not None
                else None,
                "completed_at": _format_timestamp(variant.completed_at)
                if variant.completed_at is not None
                else None,
                "duration_ms": variant.duration_ms,
                "error": variant.error,
                "metadata_json": encode_json(
                    variant.metadata,
                    field_name="variant metadata",
                    expected_type="object",
                ),
            }
            self._assert_row_matches(version.id, "variant", row, expected_variant)
            if (
                variant.created_at is not None
                and row["created_at"] != _format_timestamp(variant.created_at)
            ):
                raise HistoryConflictError(
                    f"Version {version.id} already exists with different variant timestamps"
                )
            self._assert_messages_match(conn, version.id, variant)

    def _assert_messages_match(
        self,
        conn: sqlite3.Connection,
        commit_id: str,
        variant: VariantInput,
    ) -> None:
        rows = conn.execute(
            """
            SELECT * FROM variant_messages
            WHERE commit_id = ? AND variant_index = ?
            ORDER BY position
            """,
            (commit_id, variant.index),
        ).fetchall()
        if len(rows) != len(variant.messages):
            raise HistoryConflictError(
                f"Version {commit_id} already exists with different messages"
            )
        for position, (message, row) in enumerate(zip(variant.messages, rows)):
            expected: dict[str, Any] = {
                "id": message.id
                or f"{commit_id}:{variant.index}:message:{position}",
                "position": position,
                "role": message.role,
                "content": message.content,
                "media_json": encode_json(
                    message.media,
                    field_name="message media",
                    expected_type="array",
                ),
                "metadata_json": encode_json(
                    message.metadata,
                    field_name="message metadata",
                    expected_type="object",
                ),
            }
            self._assert_row_matches(commit_id, "message", row, expected)
            if (
                message.created_at is not None
                and row["created_at"] != _format_timestamp(message.created_at)
            ):
                raise HistoryConflictError(
                    f"Version {commit_id} already exists with different message timestamps"
                )

    @staticmethod
    def _assert_row_matches(
        commit_id: str,
        record_type: str,
        row: sqlite3.Row,
        expected: dict[str, Any],
    ) -> None:
        for column, value in expected.items():
            if row[column] != value:
                raise HistoryConflictError(
                    f"Version {commit_id} already exists with different {record_type} data"
                )

    @staticmethod
    def _validate_link(
        conn: sqlite3.Connection,
        project_id: str,
        commit_id: str | None,
        label: str,
    ) -> None:
        if commit_id is None:
            return
        row = conn.execute(
            "SELECT project_id FROM commits WHERE id = ?", (commit_id,)
        ).fetchone()
        if row is None or row["project_id"] != project_id:
            raise HistoryValidationError(f"{label} must belong to the same project")

    def _apply_selection(
        self,
        conn: sqlite3.Connection,
        project_row: sqlite3.Row,
        *,
        update_head: bool,
        head_commit_id: str | None,
        update_selected: bool,
        selected_commit_id: str | None,
        update_variant: bool,
        selected_variant_index: int | None,
    ) -> bool:
        project_id = str(project_row["id"])
        current_head = cast(str | None, project_row["head_commit_id"])
        current_selected = cast(str | None, project_row["selected_commit_id"])
        current_variant = cast(int | None, project_row["selected_variant_index"])

        new_head = head_commit_id if update_head else current_head
        new_selected = selected_commit_id if update_selected else current_selected
        if update_variant:
            new_variant = selected_variant_index
        elif update_selected and selected_commit_id != current_selected:
            new_variant = None
        else:
            new_variant = current_variant

        if new_selected is None:
            new_variant = None

        self._validate_link(conn, project_id, new_head, "head commit")
        self._validate_link(conn, project_id, new_selected, "selected commit")
        if new_variant is not None:
            if new_selected is None:
                raise HistoryValidationError(
                    "A selected variant requires a selected commit"
                )
            variant_row = conn.execute(
                """
                SELECT 1 FROM variants
                WHERE commit_id = ? AND variant_index = ?
                """,
                (new_selected, new_variant),
            ).fetchone()
            if variant_row is None:
                raise HistoryValidationError(
                    "Selected variant must belong to the selected commit"
                )

        if (
            new_head == current_head
            and new_selected == current_selected
            and new_variant == current_variant
        ):
            return False

        conn.execute(
            """
            UPDATE projects
            SET head_commit_id = ?, selected_commit_id = ?, selected_variant_index = ?
            WHERE id = ?
            """,
            (new_head, new_selected, new_variant, project_id),
        )
        return True

    def _load_project(
        self,
        conn: sqlite3.Connection,
        project_id: str,
    ) -> ProjectHistory:
        project_row = conn.execute(
            """
            SELECT p.*,
                   (SELECT COUNT(*) FROM commits c WHERE c.project_id = p.id)
                       AS commit_count,
                   (
                       SELECT COUNT(*)
                       FROM variants v
                       JOIN commits c ON c.id = v.commit_id
                       WHERE c.project_id = p.id
                   ) AS variant_count
            FROM projects p
            WHERE p.id = ?
            """,
            (project_id,),
        ).fetchone()
        if project_row is None:
            raise HistoryNotFoundError("Project not found")

        commit_rows = conn.execute(
            """
            SELECT * FROM commits
            WHERE project_id = ?
            ORDER BY created_at, id
            """,
            (project_id,),
        ).fetchall()
        commit_ids = [str(row["id"]) for row in commit_rows]
        children: dict[str, list[str]] = {commit_id: [] for commit_id in commit_ids}
        roots: list[str] = []
        for row in commit_rows:
            commit_id = str(row["id"])
            parent_id = cast(str | None, row["parent_commit_id"])
            if parent_id is None:
                roots.append(commit_id)
            else:
                children.setdefault(parent_id, []).append(commit_id)

        prompts_by_commit: dict[str, list[PromptRecord]] = {
            commit_id: [] for commit_id in commit_ids
        }
        variants_by_commit: dict[str, list[VariantRecord]] = {
            commit_id: [] for commit_id in commit_ids
        }

        if commit_ids:
            placeholders = ",".join("?" for _ in commit_ids)
            prompt_rows = conn.execute(
                f"""
                SELECT * FROM prompts
                WHERE commit_id IN ({placeholders})
                ORDER BY commit_id, position
                """,
                commit_ids,
            ).fetchall()
            message_rows = conn.execute(
                f"""
                SELECT * FROM variant_messages
                WHERE commit_id IN ({placeholders})
                ORDER BY commit_id, variant_index, position
                """,
                commit_ids,
            ).fetchall()
            messages_by_variant: dict[tuple[str, int], list[HistoryMessageRecord]] = {}
            for row in message_rows:
                key = (str(row["commit_id"]), int(row["variant_index"]))
                messages_by_variant.setdefault(key, []).append(
                    HistoryMessageRecord(
                        id=str(row["id"]),
                        position=int(row["position"]),
                        role=str(row["role"]),
                        content=cast(str | None, row["content"]),
                        media=_json_array(
                            str(row["media_json"]), "message media"
                        ),
                        metadata=_json_object(
                            str(row["metadata_json"]), "message metadata"
                        ),
                        created_at=_parse_timestamp(
                            str(row["created_at"]), "message created_at"
                        ),
                    )
                )

            for row in prompt_rows:
                prompts_by_commit[str(row["commit_id"])].append(
                    PromptRecord(
                        id=str(row["id"]),
                        position=int(row["position"]),
                        role=str(row["role"]),
                        kind=str(row["kind"]),
                        content=decode_json(
                            str(row["content_json"]), field_name="prompt content"
                        ),
                        metadata=_json_object(
                            str(row["metadata_json"]), "prompt metadata"
                        ),
                        created_at=_parse_timestamp(
                            str(row["created_at"]), "prompt created_at"
                        ),
                    )
                )

            variant_rows = conn.execute(
                f"""
                SELECT * FROM variants
                WHERE commit_id IN ({placeholders})
                ORDER BY commit_id, variant_index
                """,
                commit_ids,
            ).fetchall()
            for row in variant_rows:
                commit_id = str(row["commit_id"])
                variant_index = int(row["variant_index"])
                variants_by_commit[commit_id].append(
                    VariantRecord(
                        index=variant_index,
                        model=cast(str | None, row["model"]),
                        status=str(row["status"]),
                        code=cast(str | None, row["code"]),
                        current_content=cast(
                            str | None, row["current_content"]
                        ),
                        created_at=_parse_timestamp(
                            str(row["created_at"]), "variant created_at"
                        ),
                        started_at=_optional_timestamp(
                            cast(str | None, row["started_at"]),
                            "variant started_at",
                        ),
                        completed_at=_optional_timestamp(
                            cast(str | None, row["completed_at"]),
                            "variant completed_at",
                        ),
                        duration_ms=cast(int | None, row["duration_ms"]),
                        error=cast(str | None, row["error"]),
                        metadata=_json_object(
                            str(row["metadata_json"]), "variant metadata"
                        ),
                        messages=messages_by_variant.get(
                            (commit_id, variant_index), []
                        ),
                    )
                )

        commits = [
            CommitRecord(
                id=str(row["id"]),
                commit_hash=cast(str | None, row["commit_hash"]),
                parent_commit_id=cast(str | None, row["parent_commit_id"]),
                retry_of_commit_id=cast(str | None, row["retry_of_commit_id"]),
                version_type=str(row["version_type"]),
                inputs=_json_object(str(row["inputs_json"]), "version inputs"),
                prompt_metadata=_json_object(
                    str(row["prompt_metadata_json"]), "prompt metadata"
                ),
                metadata=_json_object(
                    str(row["metadata_json"]), "version metadata"
                ),
                created_at=_parse_timestamp(
                    str(row["created_at"]), "version created_at"
                ),
                prompts=prompts_by_commit[str(row["id"])],
                variants=variants_by_commit[str(row["id"])],
                child_commit_ids=children.get(str(row["id"]), []),
            )
            for row in commit_rows
        ]
        summary = self._project_summary(project_row)
        return ProjectHistory(
            **summary.model_dump(),
            root_commit_ids=roots,
            commits=commits,
        )

    @staticmethod
    def _project_summary(row: sqlite3.Row) -> ProjectSummary:
        return ProjectSummary(
            id=str(row["id"]),
            title=str(row["title"]),
            stack=cast(str | None, row["stack"]),
            input_mode=cast(str | None, row["input_mode"]),
            metadata=_json_object(
                str(row["metadata_json"]), "project metadata"
            ),
            created_at=_parse_timestamp(
                str(row["created_at"]), "project created_at"
            ),
            updated_at=_parse_timestamp(
                str(row["updated_at"]), "project updated_at"
            ),
            head_commit_id=cast(str | None, row["head_commit_id"]),
            selected_commit_id=cast(str | None, row["selected_commit_id"]),
            selected_variant_index=cast(
                int | None, row["selected_variant_index"]
            ),
            commit_count=int(row["commit_count"]),
            variant_count=int(row["variant_count"]),
        )
