# Project Agent Instructions

Python environment:

- The backend uses [uv](https://docs.astral.sh/uv/), not Poetry.
- Preferred invocation: `cd backend && uv run <command>`.
- `uv sync` creates/updates `backend/.venv` from `uv.lock`. Never hand-edit `uv.lock`.
- `pyproject.toml` uses PEP 621 (`[project]`), with dev tools under `[dependency-groups]`.
- Python floor is **3.11** (required by `github-copilot-sdk`).

Testing policy:

- Always run backend tests after every code change: `cd backend && uv run pytest`.
- Always run type checking after every code change: `cd backend && uv run pyright`.
- Type checking policy: no new warnings in changed files (`pyright`).

## Frontend

- Frontend: `cd frontend && pnpm lint`

If changes touch both, run both sets.

## Prompt formatting

- Prefer triple-quoted strings (`"""..."""`) for multi-line prompt text.
- For interpolated multi-line prompts, prefer a single triple-quoted f-string over concatenated string fragments.

## Model providers

Providers live in `backend/agent/providers/` and implement the `ProviderSession`
protocol in `base.py`. `llm.py` is the single source of model identity: the
`Llm` enum (whose value is the id that crosses the wire), the `ModelProvider`
literal, the per-provider API-name/effort tables, and the `model_from_value` /
`provider_for_model` lookups. `factory.py` routes on `provider_for_model` and
raises `MissingProviderCredentialError`, which names the provider and the key to
add.

`model_catalog.py` decides what a user may *pick*. Copilot is discovered live
from the signed-in plan; OpenAI, Anthropic and Gemini use the maintained tables
in `llm.py`, because no reliable listing endpoint for vision-capable,
agent-usable models is wired into shot2code. It is a pure function of the
credentials passed in - callers merge request and environment keys first - so it
stays testable, and it never returns a credential. `routes/models.py` exposes it
as `GET`/`POST /api/models`.

Selection flows through `ModelSelectionStage` in `routes/generate_code.py`:
retry lineups replay verbatim, explicit picks produce one variant per model
capped by `variant_limit`, and an empty selection falls back to the sets in
`model_choice_sets.py`. Anything skipped is reported to the client rather than
dropped silently.

`github_copilot.py` is different from the others: the Copilot SDK is an *agent
runtime* that owns its own planning loop and calls tools through handlers, while
shot2code's engine also owns a loop. The provider bridges them by parking each
Copilot tool invocation on an `asyncio.Future` and handing the call back to the
engine, which resolves it via `append_tool_results`. Notes:

- Custom tool handlers must annotate their single parameter as `ToolInvocation`;
  the SDK inspects the signature to decide what to pass, and an untyped
  parameter silently receives the wrong shape.
- Use `available_tools=ToolSet().add_custom("*")` to allow shot2code's tools
  while excluding Copilot's built-in file/shell tools. Passing `[]` also drops
  the custom tools.
- Use `send_and_wait(...)`, not `send(...)`: `send` only enqueues and returns a
  message id. Pass a long timeout — the default is 60s.
- `total_cost_usd()` returns `None`. The usage event's `cost` is a premium
  *request* count, not dollars; reporting it as USD trips
  `GENERATION_MAX_COST_USD` and aborts normal runs.

## Copilot SDK BYOK and MCP in the browser

Both are **additive**. The OpenAI base URL and key, the Anthropic key, the
Gemini key, the Replicate key, the native provider catalog and the native
routing are untouched by this feature and must stay that way.

`frontend/src/lib/copilot-sdk-byok.ts` owns the BYOK connection, and
`frontend/src/lib/mcp-servers.ts` owns the server list. Both are pure and mirror
the limits and validation in `backend/integrations/config.py`.
`frontend/src/lib/integrations.ts` joins the two and builds every payload;
`integrations-client.ts` is the only I/O.

**The run identity is per selection.** One connection produces one selectable
entry per base model, `sdk-byok/<provider>/<base model id>`, published by the
backend as a fifth catalog provider, `sdk-byok`. No `Llm` value starts with that
prefix, so a BYOK identity can never collide with a native model id, and a run
may contain `gpt-5.6-sol (high thinking)` **and** its BYOK twin: two entries,
two variants, two runtimes.

That identity is what crosses the wire. `buildModelSelections` turns the saved
selection into `modelSelections: [{id, baseModel, runtime}]` - order preserved,
de-duplicated **by id only** - and a retry sends `retryModelSelections` in the
same shape. `selectedModels` still goes along as plain ids for an older backend.
A native id *is* its base model; a BYOK id carries its provider and base model,
so the mapping is a pure derivation with no catalog lookup.

`copilotSdkByok` describes what is *configured*, not what a run picked, so
sending it can never re-route a native selection. **There is no reroute warning,
because there is no rerouting**, and the native openai/anthropic/gemini/copilot
groups still require their own direct key - their `credential_source` is never
`sdk-byok`.

`variantModels` streams selection ids, so `variant.model` on a commit records
the identity a variant actually ran as. Settings and history keep the synthetic
id rather than resolving it to the base model, which is what lets a retry replay
the real runtime.

The UI is stricter than the backend in one place on purpose: a dedicated
credential is required unless the endpoint is an OpenAI-compatible server on
localhost. A direct provider key is never offered as a fallback, because it
belongs to the native runtime and must keep working there untouched.

Credentials are read from the current Settings at send time and nothing else.
`CommitGenerationContext` and the history serializers carry model ids only -
`serializeGenerationContext` is a closed allowlist, and
`frontend/src/lib/integration-generation.test.ts` asserts that no key, bearer
token, MCP env value or request header reaches a commit or a snapshot.

MCP runs for Copilot subscription variants and BYOK variants only; a native
OpenAI/Anthropic/Gemini variant never sees an MCP tool. A server needs `enabled`
*and* `trusted` before it starts, and stays read-only until `allowWriteTools` is
set as well. `env` and `headers` may hold tokens: they are masked in the list,
masked and read-only in the editor until revealed, and excluded from
`stripIntegrationSecrets`.

## Provider-neutral web search

`backend/web_search/` owns one canonical tool, **`search_web`**, and every
runtime reaches the same implementation: native OpenAI, Anthropic and Gemini
get it through their existing canonical tool serializers, and both Copilot
runtimes get it as a custom tool. There is no per-provider search path.

The package must not import `agent`. `web_search.tool` returns plain
`WebSearchToolDefinition` / `WebSearchToolOutcome` records and
`agent/tools/definitions.py` and `agent/tools/runtime.py` wrap them into
`CanonicalToolDefinition` / `ToolExecutionResult`. Importing `agent.tools.types`
from here is a circular import, because it runs `agent/tools/__init__.py`.

**One search tool per session.** `create_provider_session` enables Copilot's
built-in `web_search` only when the canonical tool is *not* usable. Offering
both would let a model take the unbounded route past the budgets, the domain
allowlist and the snippet bounds. The built-in stays available for people who
prefer it and have the entitlement — they simply leave canonical search off.

**`web_fetch` is deliberately off, and that is a decision, not a gap.** It *is*
a real runtime built-in — it appears in the bundled runtime's tool vocabulary
and in its `SandboxDecision` tool-kind enum beside `shell`, `search`, `mcp` and
`lsp` — so `ToolSet().add_builtin("web_fetch")` would work. It is still not
offered because **a built-in's output cannot be bounded**: the runtime hands
the result to the model and the SDK only notifies the host afterwards
(`tool.execution_complete`), so there is no hook to truncate it, label it
untrusted, or budget it. `web_fetch` returns a whole page, so enabling it would
put an unbounded third-party document into the model's context — the exact
thing `search_web` exists to prevent. Two further gaps: the SDK's
`create_session` accepts no URL allowlist even though the protocol defines
`PermissionUrlsConfig`, and a built-in call is not counted against the per-turn
or per-generation ceilings.

The refusal is enforced in three places, not assumed:

- `BLOCKED_BUILTIN_TOOLS` in `integrations/copilot_sdk.py`, checked by
  `assert_no_blocked_builtins`, which reads the `builtin:` entries a `ToolSet`
  would actually transmit (including a `builtin:*` wildcard) and raises rather
  than building the session.
- `decide_mcp_permission` denies every `url` permission request with a reason
  that names the host and path — never the query string, which can carry a
  token.
- `build_permission_handler` is installed on **every** Copilot session,
  subscription and BYOK, with or without MCP servers. Without a handler the
  runtime applies its own default policy, which would make "shot2code does not
  fetch URLs" an assumption instead of a rule.

Do not add a built-in whose result shot2code cannot inspect before the model
does. If a future SDK allows post-processing a built-in result, or accepts a
URL allowlist at session creation, revisit
`COPILOT_BUILTIN_WEB_FETCH_SUPPORTED` — and add the opt-in setting separately
from web search, because one capability must never imply the other.

`config.py` mirrors `integrations/config.py`: it validates the request block,
holds the only credential in the package, and keeps it out of
`WebSearchSummary`, which is what the route, the logs and diagnostics are built
from. Limits are constants there and are mirrored in
`frontend/src/lib/web-search.ts`; change both or the UI starts promising
something the backend refuses.

Endpoints are fixed per provider and are never user-configurable — the query is
the sensitive part of this feature. Requests carry an explicit timeout, set
`follow_redirects=False` (a redirect would move the `Authorization` header to
an unconfigured host), and never ask for raw page content or a generated
answer. `include_domains` is passed to the provider **and** re-applied locally,
because a provider that ignores the filter must not decide what the model
reads.

Budgets live on `WebSearchRuntime`, one per `AgentEngine`, so each variant gets
its own allowance and a retry starts clean. `AgentEngine._run_with_session`
calls `start_turn()` at the top of each model turn; the per-generation ceiling
keeps accumulating across them. A failed search still spends its allowance,
because the request left the machine either way.

Every successful response is prefixed with `UNTRUSTED_CONTENT_WARNING`. Search
results are attacker-controlled text, so they are context, never instructions.

Tavily is primary and is the only provider with a documented keyless trial
(`X-Tavily-Access-Mode: keyless`). Keyless is an explicit choice, never a
fallback when a key is missing, and it clears any saved key. Exa is optional
and always keyed. Do not add a provider whose terms restrict storing or
displaying results without first encoding that restriction in the adapter.

`summarize_web_search_input` is a closed allowlist, so anything a model
hallucinated into the arguments — including a credential — never reaches the
activity feed or the run log.

### Free-allowance claims

This applies to **every** third-party allowance shot2code mentions — search
providers, image backends, anything added later.

- Never write "free", "permanently free", "always free" or "unlimited" without
  qualification. A provider can change its plan the day after we ship, and the
  user pays that bill, not us.
- Attribute the allowance to the provider, scope it (per day / per month), and
  say it depends on their account and can change. `ALLOWANCE_CAVEAT` in
  `frontend/src/lib/web-search.ts` is the sentence the search card uses;
  `CLOUDFLARE_ALLOCATION_NOTE` in `backend/image_generation/catalog.py` is the
  image equivalent.
- Cite the provider's official pricing page next to the claim, both in the UI
  and in the docs, so a reader can check it.
- Tests must assert the hedging, not just the number. `web-search.test.ts` and
  `WebSearchSettings.test.tsx` fail if a permanent-free phrasing reappears.

Verified against official sources on 2026-09-27:

| Provider | Published terms | Source |
| --- | --- | --- |
| Tavily | 1,000 API credits/month, reset on the 1st, no credit card; basic search 1 credit, advanced 2. Separate keyless trial, rate-limited and shared. | [api-credits](https://docs.tavily.com/documentation/api-credits), [keyless](https://docs.tavily.com/documentation/keyless) |
| Exa | Pay-as-you-go, no subscription. $10 credits at sign-up, resets to $10 monthly, no payment method required. `/search` $7/1k requests for up to 10 results. | [pricing](https://exa.ai/docs/admin/pricing) |
| Cloudflare Workers AI | Daily allocation of 10,000 Neurons at no charge on **both** Workers Free and Workers Paid, resetting 00:00 UTC; beyond it needs Workers Paid at $0.011/1,000 Neurons. Some models require a paid billing method. FLUX.1 Schnell is 4.8 neurons per 512x512 tile + 9.6 neurons/step. | [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) (updated 2026-09-17) |
| Replicate | Pay only for what you use; public-model cost varies by run time, output and model page. **No permanent free API tier** may be claimed. | [pricing](https://replicate.com/pricing) |
| Hugging Face | Free users get only ~$0.10 of monthly credits, subject to change. Not a meaningful primary free backend. | [pricing](https://huggingface.co/pricing) |
| Gemini (unpaid tier) | Unpaid-tier content may be used to improve Google's products and may be human-reviewed; EEA/Switzerland/UK API clients may use only the paid services. Must never be a silent or default free provider. | [terms](https://ai.google.dev/gemini-api/terms) |
| Pollinations | No verifiable recurring quota or pricing published. Must not be labelled guaranteed free. | — |

## Image generation

The image subsystem lives in `backend/image_generation/` and is layered on
purpose. `catalog.py` says what may be picked, `settings.py` validates what a
request asked for, one module per provider makes the call, `assets.py`
normalizes whatever came back, `errors.py` classifies whatever went wrong, and
`generation.py` fans out and keeps one outcome per prompt. Nothing in there
imports from `agent/` — the shared local-asset helpers live in
`backend/asset_urls.py` for exactly that reason, and
`agent/tools/local_assets.py` is a re-export shim kept for compatibility.

**Replicate is the default and must stay default-compatible.** A request with
no `imageGeneration` block behaves exactly as it always did: Replicate,
`prunaai/z-image-turbo`, the key from the request or `REPLICATE_API_KEY`.
Cloudflare Workers AI and the OpenAI-compatible endpoint are *additive*: they
carry their own credentials and never read, replace or re-route
`replicateApiKey`, `openAiApiKey`, `anthropicApiKey` or `geminiApiKey`.

**Do not claim a model is compatible.** `prunaai/z-image-turbo` and
`black-forest-labs/flux-2-klein-4b` take different inputs (`width`/`height`/
`num_inference_steps` vs `aspect_ratio`), which is why an arbitrary Replicate
model cannot be assumed to work. A custom model must pass
`replicate.check_model_schema`, which reads the model's own published OpenAPI
schema and accepts it only if it declares a string `prompt` input and an
image-shaped output and needs nothing else. Only `prompt` is ever sent to one.

**Do not fabricate a capability.** Background removal is Replicate-only; no
other provider has an equivalent endpoint and none is substituted. Editing runs
on Replicate, or on an OpenAI-compatible endpoint that actually implements
`/images/edits` — a `404`/`405`/`501` there is reported as a missing capability,
not as a failure the user can fix with a key.

**Cost wording is attributed, dated and hedged.** A bare number ages into a
lie, but so does an unqualified "free". Each catalog entry names who bills,
quotes the provider's own published figure with the date it was read, links
that provider's pricing page, and says the terms can change. **No provider may
be described as permanently free**; an allowance is always attributed, scoped
to a period, and marked subject to account and model availability.
Cloudflare's is 10,000 Neurons a day on **both** the Workers Free and Workers
Paid plans, resetting at 00:00 UTC — not Free-plan-only, which an earlier
version of this copy got wrong. `CLOUDFLARE_ALLOCATION_NOTE` is shared by the
backend and the UI so the two cannot drift, and tests on both sides assert the
exact clauses.

Hugging Face, Gemini's unpaid tier and Pollinations are deliberately **not**
offered as free backends: a nominal monthly credit, terms that permit training
on unpaid content plus paid-only regions, and no published quota at all,
respectively. Adding one would need an explicit opt-in and its own disclosure.

**Failures are per prompt.** `generate_images` returns one `ImageResult` per
prompt, each either a `NormalizedImage` or a classified
`ImageProviderFailure` (429 quota, 402 billing, 401 credentials, timeout
network, and so on). A partial batch reports "Generated X of N"; a batch that
produced nothing returns `ToolExecutionResult(ok=False)` with the reason. Never
return a success-shaped item with an empty URL, and never count tiles instead
of successes — `frontend/src/components/agent/image-results.ts` mirrors those
counting rules for the activity feed.

**Everything a provider returns goes through `normalize_image_result`.** It
keeps a public `http(s)` URL, writes bytes/base64/`data:` payloads to the
served asset directory, and refuses anything else (`file:`, loopback that is
not one of our own assets, private ranges, oversized payloads). A local asset
URL is not model-reachable, so the bytes travel on the result and the runtime
builds a `ToolMultimodalPart` from `data` rather than `image_url`.

`frontend/src/lib/image-providers.ts` mirrors the catalog and the validation
rules; `image-models-client.ts` is the only I/O. Image credentials are read
from the current Settings at send time: `toGenerationSettings` deliberately
drops the raw `imageGeneration` block so it cannot be spread into a request,
and `toImageGenerationWirePayload` is the single place that decides which
credential travels.

## Free image search

`backend/free_images/` owns one canonical tool, **`search_free_images`**,
reaching every runtime through the same serialization `search_web` uses. It is
**keyless** - Openverse's search API needs no credential - which makes it the
only image path that works with no Replicate, Cloudflare or OpenAI-compatible
configuration. It is additive: configuring one of those never switches it off.

**It is a separate tool, never a fallback inside `generate_images`.** One
invents a picture, the other finds a real photograph somebody released. Quietly
swapping them would give a user stock photography where they asked for an
illustration. The model chooses, and the activity feed says which happened
("Found 3 free images", not "Generated").

**CC0 and Public Domain Mark only, and it is re-checked locally.** Every other
Creative Commons licence carries an obligation an exported project would
inherit - BY needs attribution wherever the image appears, SA spreads to the
combined work, NC forbids shipping, ND forbids cropping - and shot2code cannot
enforce any of that in someone else's codebase. `normalize_result` re-checks
the licence itself rather than trusting the server's `license=` filter, and
drops any result missing a source page or licence URL, because the user could
not verify it. `VERIFY_METADATA_WARNING` travels with every response: Openverse
aggregates other people's metadata and can be wrong.

The package must not import `agent`, for the same reason `web_search` must not.

**`download.py` is the hostile-input boundary** and the part to be careful
with. Every URL came from a third-party index describing a fourth party's
server, so: DNS resolution with *every* returned address checked against
private, loopback, link-local, reserved, multicast and cloud-metadata ranges
(a mixed answer is refused outright as a rebinding attempt); redirects
disabled and each `Location` re-validated from scratch with a hop limit;
content type checked against an allowlist *and* against sniffed magic bytes,
which must agree; byte and decoded-pixel ceilings; and a filename derived from
the title rather than the attacker-controlled path. Bytes then go through
`persist_image_bytes`, so a free image becomes a local `/local-assets/` URL
exactly like a generated one. **Never hotlink an external image into generated
or exported markup.**

Web search is deliberately not involved. A web image result grants no reuse
right, and `test_free_image_search.py` asserts by AST that this package imports
and calls nothing from `web_search`, Tavily or Exa.

## Imported project context

The Import tab can analyse a folder, ZIP, or selected source files through
`backend/routes/project_context.py`.

- Never execute imported code or load its configuration modules. In particular,
  do not `require()`/import `tailwind.config.*`; parse text only.
- The scanner rejects traversal paths, ignores dependency/build directories,
  limits file count, per-file size, archive size, and total decoded text.
- Raw source is not persisted in `ProjectContext`. Inspection may return a
  transient versioned editable payload; `frontend/src/lib/project-import.ts`
  defines that neutral contract and `EditableProjectImportHandler` handoff.
  Only the compact `ProjectContext.summary` is stored in frontend settings and
  appended to the selected manual design system before prompt construction.
- Keep editor/store adapters outside the import scanner. Import paths must stay
  normalized, relative and text-only before crossing the callback boundary.
- Generation previews remain self-contained. Imported component paths are
  naming/API context, not permission to emit local imports that the preview
  cannot resolve.

Multiple screenshots carry an explicit `multiImageMode`: `pages`, `responsive`,
`states`, or `references`. When absent with more than one image, `pages` is the
backend default so every screenshot must be represented.

## Desktop app

`desktop/` is an Electron shell that starts the frozen backend on a free port,
waits for `/api/health`, then loads the built frontend from disk.

Backend startup keeps only health, settings/model, design-system and history
routes on the critical import path. Generation, project tools and eval routes
are loaded on first use, while Chromium and Copilot capability probes run as
bounded background tasks. Do not move optional discovery back into an awaited
FastAPI startup hook: frozen imports and antivirus scanning can make those
probes take minutes even though the core API is healthy.

The native application menu is built in `desktop/app-menu.js`, which returns the
whole template as plain data and never requires Electron, so `app-menu.test.js`
asserts labels, accelerators, enablement and click routing under `node --test`.

- A menu item that maps to app behaviour **sends a typed command** on
  `shot2code:menu-command`; `App.tsx` runs it through `runAppCommand`, the same
  dispatcher the keyboard shortcuts use. Never reimplement a behaviour in the
  menu, and never add a command id that is missing from `APP_COMMANDS` in
  `frontend/src/lib/app-shortcuts.ts` - the renderer drops unknown commands.
- Those items must keep `registerAccelerator: false`. Registering them would
  hand **Ctrl+Z** to the menu (CodeMirror keeps its own history and would undo
  nothing), swallow **Ctrl+/** inside the editor, bypass the in-app guards for
  text fields and open dialogs, and double-apply zoom, which `zoom-controls.js`
  already owns through `before-input-event`. `registerAccelerator` is honoured
  on Windows and Linux only.
- Menu clicks go through `focusMainWindow()` first, so a command works while the
  window is hidden or minimised.
- The renderer publishes `{ hasProject, canExport, isChatPanelVisible }` on
  `shot2code:menu-state`. Until it does, project-only items stay enabled and the
  renderer shows its own toast; that is deliberate, because a silently dead menu
  item is worse than an honest message.
- New files in `desktop/` must be added to `files:` in `electron-builder.yml` or
  they are missing from the packaged app.

The UI is served over `file://` in the packaged app but over `http://` in dev,
and that difference has caused every desktop-only bug so far. When touching
anything in this list, verify it in the packaged app, not just `pnpm dev`:

- **Routing.** `location.pathname` is the file's path on disk, so
  `BrowserRouter` matches nothing and the window renders blank. `main.tsx`
  picks `HashRouter` when `protocol === "file:"`.
- **Asset paths.** Absolute paths like `/favicon/main.png` resolve to the drive
  root. Use relative paths.
- **`location.origin`** is the string `"null"`. Anything interpolating it into
  markup (a `<base>` tag, a fetch URL) silently breaks.
- **`window.open`.** The shell only sends `http(s)` to the OS browser; other
  schemes (`blob:`, `data:`) must open in-app, because `shell.openExternal`
  cannot handle them.
- **`getDisplayMedia`** is rejected unless the main process registers a
  display-media handler.
- **Env vars** are baked in by Vite at build time, so the backend port cannot
  come from `import.meta.env`. It is injected through preload and read in
  `config.ts`.

A blank or missing window is diagnosed from the log, not the console:

```
%APPDATA%\shot2code-desktop\shot2code-backend.log
```

It captures backend startup, `did-fail-load`, renderer crashes and console
errors.

Packaging notes:

- The backend is frozen with PyInstaller (`backend/shot2code-backend.spec`).
  The stock Python `.gitignore` excludes `*.spec`; ours is hand-written and must
  stay tracked.
- Only `chromium-headless-shell` is bundled. Full Chromium adds ~427MB and the
  app always launches headless.
- Never round-trip `desktop/package.json` through `ConvertFrom-Json`/
  `ConvertTo-Json` - it drops fields. Edit it as text.
- Auto-update is active through the public GitHub Releases feed.
- Updates must kill the backend process tree synchronously before
  `quitAndInstall`; an asynchronous `taskkill` allowed NSIS to replace a live
  PyInstaller tree and produced partial installs missing native `.pyd` modules.
- `quitAndInstall()` defaults to an interactive wizard. Use
  `quitAndInstall(true, true)` for a silent update followed by relaunch.
- MSI is per-machine managed deployment. The shell detects Program Files and
  disables self-update there; NSIS remains the self-updating per-user format.
- Every release must upload the NSIS `.exe`, its `.exe.blockmap`, `latest.yml`,
  MSI, and portable ZIP. Without the blockmap, updates fall back to downloading
  the full installer.

## Environment caveats

Services (see `README.md` for the canonical commands):
- Backend (FastAPI + WebSocket): from `backend/`, `uv run uvicorn main:app --reload --port 7001`.
- Frontend (Vite/React): from `frontend/`, `pnpm dev` → open `http://localhost:5173`. The Vite dev server binds to `localhost` only, so use `http://localhost:5173`, not `http://127.0.0.1:5173`.
- Frontend talks to the backend over a WebSocket (`VITE_WS_BACKEND_URL`, default `ws://127.0.0.1:7001`); generation streams over that socket, other routes are plain HTTP.

Non-obvious caveats:
- Generation needs either GitHub Copilot credentials (`gh auth login` or a stored `copilot` login) **or** an LLM key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) in `backend/.env` or the Settings dialog. With none of these, generation fails fast. Image generation is separate: `REPLICATE_API_KEY` (the default backend, settable in `backend/.env` *or* the Settings dialog), or the optional `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`, or an OpenAI-compatible image endpoint configured in Settings.
- Playwright Chromium powers the optional "Screenshot preview" tool; Settings shows whether it is available. The backend `Dockerfile` accepts `--build-arg INSTALL_CHROMIUM=false` to skip it.
- Web search is off by default and needs no key to try: Tavily's keyless trial is an explicit opt-in in Settings. `TAVILY_API_KEY` / `EXA_API_KEY` in `backend/.env` are consulted only for the provider the request selected, and only when that request carries no key of its own.
- `pnpm install` prints an "Ignored build scripts (esbuild, puppeteer)" warning — harmless.
- `cd frontend && pnpm lint` reports pre-existing errors (e.g. `@typescript-eslint/no-explicit-any` in `generateCode.ts`) because lint runs with `--max-warnings 0`; these are baseline issues, not regressions.
