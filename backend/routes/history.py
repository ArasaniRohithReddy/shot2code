"""FastAPI routes for desktop-local project history."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from typing import TypeVar

from fastapi import APIRouter, HTTPException, Query, Response

from history import (
    HistoryConflictError,
    HistoryDataError,
    HistoryNotFoundError,
    HistoryStore,
    HistoryValidationError,
)
from history.models import (
    AppendVersionRequest,
    HistoryHealthResponse,
    Identifier,
    ProjectHistory,
    ProjectListResponse,
    ProjectSnapshotRequest,
    SelectionUpdateRequest,
)

router = APIRouter(prefix="/api/history", tags=["history"])

T = TypeVar("T")


def _execute(operation: Callable[[], T]) -> T:
    try:
        return operation()
    except HistoryNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except HistoryConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except HistoryValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HistoryDataError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except sqlite3.Error as exc:
        print(f"[history-db] SQLite error: {exc}")
        raise HTTPException(
            status_code=500,
            detail="History database operation failed",
        ) from exc


def _store() -> HistoryStore:
    return HistoryStore()


@router.get("/health", response_model=HistoryHealthResponse)
def history_health() -> HistoryHealthResponse:
    return _execute(lambda: _store().health())


@router.get("/projects", response_model=ProjectListResponse)
def list_projects(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ProjectListResponse:
    projects = _execute(lambda: _store().list_projects(limit=limit, offset=offset))
    return ProjectListResponse(projects=projects)


@router.get("/projects/{project_id}", response_model=ProjectHistory)
def get_project(project_id: Identifier) -> ProjectHistory:
    return _execute(lambda: _store().get_project(project_id))


@router.put("/projects/{project_id}", response_model=ProjectHistory)
def save_project_snapshot(
    project_id: Identifier,
    request: ProjectSnapshotRequest,
) -> ProjectHistory:
    return _execute(lambda: _store().save_project_snapshot(project_id, request))


@router.post("/projects/{project_id}/versions", response_model=ProjectHistory)
def append_project_version(
    project_id: Identifier,
    request: AppendVersionRequest,
) -> ProjectHistory:
    return _execute(
        lambda: _store().append_version(
            project_id,
            request.version,
            set_as_head=request.set_as_head,
            select_commit=request.select_commit,
            selected_variant_index=request.selected_variant_index,
        )
    )


@router.patch("/projects/{project_id}/selection", response_model=ProjectHistory)
def update_project_selection(
    project_id: Identifier,
    request: SelectionUpdateRequest,
) -> ProjectHistory:
    return _execute(lambda: _store().update_selection(project_id, request))


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: Identifier) -> Response:
    _execute(lambda: _store().delete_project(project_id))
    return Response(status_code=204)
