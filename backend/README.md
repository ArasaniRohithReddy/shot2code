# Run the type checker

uv run pyright

# Run tests

uv run pytest

## Prompt Summary

Use `print_prompt_summary` from `utils.py` to quickly visualize prompts:

```python
from utils import print_prompt_summary
print_prompt_summary(prompt_messages)
```

## Desktop history database

Project history is stored in a versioned SQLite database using Python's standard
library. Set `SHOT2CODE_HISTORY_DB_PATH` to an exact database file path, or set
`SHOT2CODE_DATA_DIR` to a directory that will contain `history.sqlite3`.

Without either variable, the database defaults to the platform's local app-data
location under a `shot2code` directory (on Windows,
`%LOCALAPPDATA%\shot2code\history.sqlite3`; on macOS,
`~/Library/Application Support/shot2code/history.sqlite3`; on Linux,
`$XDG_DATA_HOME/shot2code/history.sqlite3` or
`~/.local/share/shot2code/history.sqlite3`). The backend creates the directory,
enables SQLite foreign keys and WAL mode, and applies idempotent migrations when
the database is opened.

The local API is rooted at `/api/history`: list projects, fetch a complete
version tree, atomically upsert a project with an optional version, append an
immutable version, update head/selection pointers, delete a project, and inspect
schema health at `/api/history/health`.
