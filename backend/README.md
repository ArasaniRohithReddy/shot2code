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
`sdk-byok/<provider>/<base model>`, or a single
`sdk-byok/<provider>/custom/<url-encoded model>` entry when the connection names
its own endpoint model. Each entry carries `runtime` and, for BYOK, the
`base_model_id` it borrows its prompt shape from.

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
retry keeps the runtime identity; `retryModelSelections` replays it.

A custom endpoint model is addressed by its own identity and may also carry
`wireModel`. Model names are bounded to 128 characters, may contain slashes,
colons, dots and `@`, and are URL-encoded into the id. The run borrows a
neutral non-reasoning template for the SDK's `model_id`, and **no reasoning
effort is sent** for such a model — only the real name goes on the wire as
`wire_model`.

`POST /api/integrations/validate` validates the optional `copilotSdkByok` and
`mcpServers` blocks without contacting an endpoint or starting a server. BYOK
uses only its dedicated API key or bearer token. MCP servers must be enabled and
trusted; write tools require a separate opt-in, and inactive/incomplete drafts
are returned as diagnostics rather than blocking direct-provider generations.

`POST /api/providers/validate` runs a *live* check for one provider
(`openai`, `anthropic`, `gemini`, `replicate`, `copilot-byok`) and answers
`{provider, ok, category, message, modelId?, models[]}`. `category` is one of
`ready`, `credentials`, `billing`, `quota`, `permissions`, `model`, `network`,
`configuration`, `unknown`. Each check makes one minimal but real request, so
the account may be billed a negligible amount; Replicate uses its account
endpoint instead. Responses never contain a credential.

- The credential is the request's when present, otherwise the backend's own.
- **A request that supplies `baseUrl` must also supply `apiKey`.** The
  environment key is only used with the backend's own configured base URL, so it
  can never be sent to a caller-chosen host. A caller URL is validated with the
  same rules as a BYOK endpoint: `http`/`https`, no embedded credentials, HTTPS
  unless loopback.
- For an OpenAI-compatible BYOK connection the check first asks the endpoint for
  `/models` and returns a bounded, sanitised `models` list. `404`, `405` and
  `501` mean the optional route is not implemented, so the check continues with
  the manually named wire model; other listing failures are reported with their
  category. Azure OpenAI and Anthropic skip listing entirely.
- A BYOK connection with its own base URL defaults to the `completions` wire
  API; a connection without one defaults to `responses`. An explicit `wireApi`
  always wins.

## Copilot sign-in API

`POST`/`GET`/`DELETE /api/copilot/login` drive an in-app sign-in that delegates
to the official CLI: `copilot --no-auto-update login --web-flow`, falling back
to `gh auth login --hostname github.com --git-protocol https --web
--skip-ssh-key`. The argument vectors are constants, the process is spawned with
`create_subprocess_exec` (never a shell) and hidden on Windows, and its stdout
and stderr are drained but never returned or logged. No token passes through the
backend; on success it re-runs `probe_copilot_auth(force=True)`.

Responses are `{status, method, message, login, canCancel, installUrl}` with
`status` in `idle|starting|waiting|succeeded|failed|cancelled|unavailable`. The
run is bounded by a timeout, cancellable, and killed on application shutdown.

`POST` and `DELETE` are refused with 403 unless the request carries a local UI
origin — an `http`/`https` origin whose hostname is exactly `localhost`,
`127.0.0.1` or `::1`, or the packaged app's `null` origin. A missing origin is
refused too. `GET` is read-only and unguarded.
