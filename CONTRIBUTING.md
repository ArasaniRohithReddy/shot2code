# Contributing to shot2code

Thanks for wanting to help. This is a small project, so the process is light:
open an issue for anything non-trivial before you write a lot of code, keep pull
requests focused, and make sure the checks below pass.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

Two documents are worth reading before you start:

- **[AGENTS.md](AGENTS.md)** — the conventions and hard-won gotchas for this
  repo (provider bridge, import scanner rules, desktop `file://` traps,
  packaging notes). Treat it as required reading.
- **[TESTING.md](TESTING.md)** — the full, canonical list of test commands.

## Prerequisites

- [uv](https://docs.astral.sh/uv/) — the backend uses uv, **not** Poetry
- [pnpm](https://pnpm.io/) (the repo pins `pnpm@10.32.1`)
- Node.js 18+ (CI builds with Node 20)
- Python **3.11+** — required by `github-copilot-sdk`
- Windows 10/11 x64 if you touch the desktop shell or packaging

Generation needs credentials: either GitHub Copilot (`gh auth login`, or a
`copilot` login) or an API key for OpenAI, Anthropic or Gemini in
`backend/.env` or the Settings dialog. `REPLICATE_API_KEY` only works from
`backend/.env`.

## Backend (Python / FastAPI)

```bash
cd backend
uv sync
uv run playwright install chromium   # optional: screenshot-preview tool
uv run uvicorn main:app --reload --port 7001
```

Never hand-edit `uv.lock`; let `uv` update it. Dependencies live in
`pyproject.toml` (PEP 621 `[project]`, dev tools under `[dependency-groups]`).

Run after **every** backend change:

```bash
cd backend
uv run pytest
uv run pyright
```

Type-checking policy: **no new pyright warnings in the files you touched.**

Narrower runs while iterating:

```bash
uv run pytest tests/test_export.py
uv run pytest -k copilot
```

Export changes should also be validated end to end (needs Node, npm and network;
it really runs `npm install` and `npm run build` for all 12 stacks):

```bash
cd backend
uv run python scripts/validate_export_projects.py
```

The opt-in browser matrix exercises the real sandboxed preview bridge:

```bash
RUN_STACK_E2E=true uv run pytest tests/test_stack_browser_runtime.py
```

## Frontend (React / Vite)

```bash
cd frontend
pnpm install
pnpm dev          # http://localhost:5173 — use localhost, not 127.0.0.1
```

Run after **every** frontend change:

```bash
cd frontend
pnpm test               # jest
pnpm exec tsc --noEmit  # type check
pnpm lint               # eslint, --max-warnings 0
pnpm build              # tsc && vite build
```

`pnpm lint` reports a handful of **pre-existing** errors (mostly
`@typescript-eslint/no-explicit-any`, e.g. in `generateCode.ts`) because it runs
with `--max-warnings 0`. Those are baseline; just don't add new ones.
`pnpm install` printing *"Ignored build scripts (esbuild, puppeteer)"* is
harmless.

If your change touches both halves of the app, run both sets.

## Desktop shell and packaging

The Electron shell is plain Node, so start with a syntax check, then run the
shell's test suite:

```powershell
cd desktop
node --check main.js
node --check preload.js
node --check app-menu.js
npm test
```

The native application menu lives in `desktop/app-menu.js`, which builds the
whole template as plain data and never imports Electron, so `app-menu.test.js`
can assert labels, accelerators, enablement and click routing without launching
a browser process. Two rules keep it honest, and both are enforced by tests:

- A menu item the app already knows how to do **sends a typed command** to the
  renderer over `shot2code:menu-command`, and the renderer runs it through the
  same dispatcher its keyboard shortcut uses. The menu never reimplements a
  behaviour, and its command ids must exist in `APP_COMMANDS`
  (`frontend/src/lib/app-shortcuts.ts`).
- Those items set `registerAccelerator: false`. The key is printed beside the
  label but left to the page, so CodeMirror keeps **Ctrl+Z** and **Ctrl+/**,
  the in-app guards for text fields and open dialogs still apply, and zoom is
  still applied exactly once by the `before-input-event` handler in
  `zoom-controls.js`.

The renderer reports `{ hasProject, canExport, isChatPanelVisible }` back over
`shot2code:menu-state` so project-only items can be disabled; until that first
message arrives the items stay enabled and the renderer answers with its own
toast rather than the menu silently doing nothing.

The packaged app serves the UI over `file://` while `pnpm dev` serves it over
`http://`, and that single difference has caused every desktop-only bug so far.
**Anything that changes routing, asset paths, `location.origin`, `window.open`,
`getDisplayMedia`, or how the backend URL reaches the renderer must be verified
in a packaged build, not just `pnpm dev`.** When a window is blank or never
appears, read the log rather than the console:

```
%APPDATA%\shot2code-desktop\shot2code-backend.log
```

Run the shell against a locally built renderer:

```powershell
cd frontend; pnpm build; cd ..
Remove-Item -Recurse -Force desktop\renderer -ErrorAction SilentlyContinue
Copy-Item -Recurse frontend\dist desktop\renderer
cd desktop; npx electron .
```

Packaging expectations:

- The backend is frozen with PyInstaller using the hand-written
  `backend/shot2code-backend.spec`. It must stay tracked despite the stock
  Python `.gitignore` excluding `*.spec`.
- Only `chromium-headless-shell` is bundled. Full Chromium adds ~427 MB and the
  app always launches headless.
- A Windows build must produce the NSIS `.exe`, its `.exe.blockmap`,
  `latest.yml`, the `.msi` and the portable `.zip`. Dropping the blockmap
  silently degrades updates to full-installer downloads.
- **Never round-trip `desktop/package.json` through `ConvertFrom-Json` /
  `ConvertTo-Json`** — it drops fields. Edit it as text.
- `desktop/package.json` holds the released product version. Do not bump it in a
  feature PR; see [docs/RELEASING.md](docs/RELEASING.md).

Full local packaging commands are in [docs/RELEASING.md](docs/RELEASING.md).

## Pull requests

- **One change per PR.** Split unrelated fixes; a small diff gets reviewed
  faster.
- **Open an issue first** for new features, new output stacks, or anything that
  changes an API contract or the on-disk history schema.
- **Write a real description.** What problem, what approach, what you verified.
  Fill in the [pull request template](.github/PULL_REQUEST_TEMPLATE.md) and link
  the issue it closes.
- **Commit messages:** a short imperative subject (≤ 72 chars) and a body
  explaining *why*. A Conventional Commits prefix (`feat:`, `fix:`, `docs:`) is
  welcome but not required.
- **Add or update tests** for behaviour changes. Bug fixes should come with a
  test that fails without the fix.
- **Update the docs you invalidate** — `README.md`, `TESTING.md`,
  `Troubleshooting.md`, `AGENTS.md`, `design-docs/` — and add a bullet to the
  `## [Unreleased]` section of [CHANGELOG.md](CHANGELOG.md) for anything a user
  would notice.
- **Paste the commands you ran** and their outcome. State clearly if you could
  not run something (for example, no Copilot subscription, or no Windows machine
  for a packaged-app check).
- **Don't bump versions** in `package.json`, `desktop/package.json`,
  `backend/pyproject.toml` or `frontend/package.json`, and don't touch release
  tags or published assets.
- Keep generated artefacts out of the diff: `desktop/renderer`,
  `desktop/backend-dist`, `desktop/dist`, `backend/dist-pyinstaller`,
  `node_modules`, `.venv`.

## No secrets, ever

- Never commit API keys, GitHub tokens, `backend/.env`, or `.env.local`.
- Redact keys and tokens from logs, screenshots and test fixtures before you
  attach them to an issue or a PR.
- Don't commit a `history.sqlite3` database or exported projects — they contain
  your own work, and possibly your prompts.
- If you leak a credential, revoke it immediately; rewriting history is not a
  substitute for revocation.
- Found a vulnerability? Do **not** open a public issue — follow
  [SECURITY.md](SECURITY.md).

## Getting help

Stuck, or not sure whether something is a bug? See [SUPPORT.md](SUPPORT.md) and
[Troubleshooting.md](Troubleshooting.md).
