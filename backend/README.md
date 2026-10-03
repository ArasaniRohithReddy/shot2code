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

## Design-source APIs

- `POST /api/figma` renders selected frames and preserves original image fills
  plus export-marked nodes as bounded local assets. Optional asset failures are
  partial-success. The Figma token is capture-only.
- `POST /api/design-assets` persists bounded Stitch resources into the shared
  local asset store. The Electron-side Stitch localizer performs pinned public
  DNS, redirect, MIME/magic-byte and size checks before calling it.
- `POST /api/github-repository` downloads a public archive or uses a separate
  fine-grained `Contents: read` token for a private repository, then routes text
  through the never-execute project scanner and bounded images through the
  local-asset path.
- `POST /api/url-design-inspector` proxies every browser HTTP(S) request through
  public-only pinned resolution and returns computed design evidence plus
  desktop/tablet/mobile screenshots. It does not recover original source.

Imported source text is untrusted evidence, not instructions. Credentials are
excluded from summaries, model prompts, History and exports; persisted asset
references use `shot2code-local:/local-assets/...` and are rebound to the
current backend origin when restored.

## Image model API

`GET /api/image-models` returns the curated image catalog: the providers
(`replicate`, `cloudflare`, `openai-compatible`), their default model, whether
each supports background removal, editing and custom models, and a `costNote`
per model. It is a pure read — no credential goes in and none comes out — and
it never states a price figure, only who bills and where to check.

`POST /api/image-models/validate` is the **only** way a Replicate model outside
the catalog becomes usable. It reads that model's own OpenAPI schema from
`GET /v1/models/{owner}/{name}` and accepts it only if the schema declares a
string `prompt` input and an image-shaped output, and requires no other input
shot2code does not send. Non-Replicate providers are refused, because they do
not publish a per-model schema to check. Answers are
`{ok, provider, model, category, message}` and never echo the key.

A generation request may carry an optional `imageGeneration` block
(`provider`, `model`, `cloudflareAccountId`, `cloudflareApiToken`,
`openAiImageBaseUrl`, `openAiImageApiKey`). It is additive: when absent the run
behaves exactly as before — Replicate, `prunaai/z-image-turbo`, the key from
the request or `REPLICATE_API_KEY`. A non-loopback image endpoint must supply
its own key; a loopback one may omit it. Endpoint URLs are held to the same
rules as a BYOK endpoint.

Optional environment variables: `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` supply Workers AI credentials to headless runs. Their
absence never affects Replicate.

## Free image search

A request may carry `freeImageSearch: {enabled: bool}`. Absent means off, so an
older client behaves exactly as before. There is **no credential**: Openverse's
image search is public, so this tool works with no image-generation provider
configured, and configuring one never disables it.

When enabled, the canonical `search_free_images` tool is serialized for every
runtime. It takes `query`, `count` (1-4) and `orientation`
(`any`/`landscape`/`portrait`/`square`, translated to Openverse's own
`wide`/`tall`/`square`). One call is one request to the fixed endpoint
`https://api.openverse.org/v1/images/`, always with `license=cc0,pdm`, bounded
by three searches per turn and ten per generation. A `429` is reported with its
`Retry-After` as advice; a timeout and a 4xx/5xx are classified separately.

Results are filtered again locally rather than trusting the server's filter,
and any result missing a source page or licence URL is dropped. Selected images
are downloaded through `free_images.download`, which refuses non-`http(s)`
schemes, DNS-resolves and rejects private/loopback/metadata addresses, does not
follow redirects (each `Location` is re-validated), requires the declared MIME
and the sniffed bytes to agree within an image allowlist, and enforces byte and
pixel ceilings. Bytes are persisted with `persist_image_bytes`, so the model
and the page get a local `/local-assets/` URL and nothing external is
hotlinked.

Streamed tool arguments are `query`, `count` and `orientation` only. Nothing
here touches history or commit snapshots, because there is no credential to
carry.

## Copilot built-in tools

A Copilot session is built with `ToolSet().add_custom("*")` — shot2code's own
tools — plus, one at a time and never by a loop: `builtin:web_search` when the
user opted in and the canonical `search_web` is not usable, `builtin:skill`
when skills are enabled, and `mcp:*` when trusted servers exist. Copilot's file
and shell built-ins are never added.

`builtin:web_fetch` is refused. It is a genuine runtime built-in, but a
built-in's result is handed to the model by the runtime and reaches the host
only as a `tool.execution_complete` notification, so its text cannot be
truncated, labelled untrusted or budgeted before the model reads it — and
`web_fetch` returns a whole page. `assert_no_blocked_builtins` inspects the
`builtin:` entries a `ToolSet` would transmit (a `builtin:*` wildcard included)
and raises instead of creating the session.

`build_permission_handler` is installed on **every** Copilot session,
subscription and BYOK, with or without MCP servers; without it the runtime
applies its own default policy. It denies every `url` permission request with a
reason naming the scheme, host and path — the query string is dropped, because
it can carry a token — and approves an MCP call only for a configured, trusted
server, with write tools requiring `allowWriteTools`. `approve_all` is never
used.

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
