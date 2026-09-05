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
