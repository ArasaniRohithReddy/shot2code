"""Project history persistence package."""

from history.database import (
    DATA_DIR_ENV,
    HISTORY_DB_PATH_ENV,
    LATEST_SCHEMA_VERSION,
    HistoryConflictError,
    HistoryDataError,
    HistoryNotFoundError,
    HistoryValidationError,
    get_history_db_path,
    open_history_db,
)
from history.store import HistoryStore

__all__ = [
    "DATA_DIR_ENV",
    "HISTORY_DB_PATH_ENV",
    "LATEST_SCHEMA_VERSION",
    "HistoryConflictError",
    "HistoryDataError",
    "HistoryNotFoundError",
    "HistoryStore",
    "HistoryValidationError",
    "get_history_db_path",
    "open_history_db",
]
