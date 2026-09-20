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

## Model and integration APIs

`/api/models` exposes a secret-free catalogue. Native OpenAI, Anthropic and
Gemini groups are available only when their direct credentials are present;
GitHub Copilot is discovered from the signed-in plan. A configured Copilot SDK
BYOK connection appears as a separate `sdk-byok` group whose ids are
`sdk-byok/<provider>/<base model>`.

Generation accepts the authoritative per-selection shape:

```json
{
  "modelSelections": [
    {
      "id": "gpt-5.6-sol (high thinking)",
      "baseModel": "gpt-5.6-sol (high thinking)",
      "runtime": "native"
    },
    {
      "id": "sdk-byok/azure/gpt-5.6-sol (high thinking)",
      "baseModel": "gpt-5.6-sol (high thinking)",
      "runtime": "copilot-byok"
    }
  ]
}
```

Legacy `selectedModels` and `retryModels` remain supported when the typed fields
are absent. The selection id is persisted in `variantModels` and History so a
retry keeps the runtime identity.

`POST /api/integrations/validate` validates the optional `copilotSdkByok` and
`mcpServers` blocks without contacting an endpoint or starting a server. BYOK
uses only its dedicated API key or bearer token. MCP servers must be enabled and
trusted; write tools require a separate opt-in, and inactive/incomplete drafts
are returned as diagnostics rather than blocking direct-provider generations.
