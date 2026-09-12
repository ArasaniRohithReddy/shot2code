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
protocol in `base.py`. `factory.py` maps a model to its provider using the
membership sets in `llm.py`.

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

## Imported project context

The Import tab can analyse a folder, ZIP, or selected source files through
`backend/routes/project_context.py`.

- Never execute imported code or load its configuration modules. In particular,
  do not `require()`/import `tailwind.config.*`; parse text only.
- The scanner rejects traversal paths, ignores dependency/build directories,
  limits file count, per-file size, archive size, and total decoded text.
- Raw source is not persisted. Only the compact `ProjectContext.summary` is
  stored in frontend settings and appended to the selected manual design system
  before prompt construction.
- Generation previews remain self-contained. Imported component paths are
  naming/API context, not permission to emit local imports that the preview
  cannot resolve.

Multiple screenshots carry an explicit `multiImageMode`: `pages`, `responsive`,
`states`, or `references`. When absent with more than one image, `pages` is the
backend default so every screenshot must be represented.

## Desktop app

`desktop/` is an Electron shell that starts the frozen backend on a free port,
waits for `/api/health`, then loads the built frontend from disk.

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
- Auto-update is wired but inert while the repo is private: release assets need
  an authorization token that a shipped app cannot hold safely.

## Environment caveats

Services (see `README.md` for the canonical commands):
- Backend (FastAPI + WebSocket): from `backend/`, `uv run uvicorn main:app --reload --port 7001`.
- Frontend (Vite/React): from `frontend/`, `pnpm dev` → open `http://localhost:5173`. The Vite dev server binds to `localhost` only, so use `http://localhost:5173`, not `http://127.0.0.1:5173`.
- Frontend talks to the backend over a WebSocket (`VITE_WS_BACKEND_URL`, default `ws://127.0.0.1:7001`); generation streams over that socket, other routes are plain HTTP.

Non-obvious caveats:
- Generation needs either GitHub Copilot credentials (`gh auth login` or a stored `copilot` login) **or** an LLM key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) in `backend/.env` or the Settings dialog. With none of these, generation fails fast. `REPLICATE_API_KEY` only works via `backend/.env`, not the UI.
- Playwright Chromium powers the optional "Screenshot preview" tool; Settings shows whether it is available. The backend `Dockerfile` accepts `--build-arg INSTALL_CHROMIUM=false` to skip it.
- `pnpm install` prints an "Ignored build scripts (esbuild, puppeteer)" warning — harmless.
- `cd frontend && pnpm lint` reports pre-existing errors (e.g. `@typescript-eslint/no-explicit-any` in `generateCode.ts`) because lint runs with `--max-warnings 0`; these are baseline issues, not regressions.
