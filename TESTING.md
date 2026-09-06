# Testing

## Backend

The backend uses [uv](https://docs.astral.sh/uv/). Install dependencies once:

```bash
cd backend
uv sync
```

Run the whole suite:

```bash
uv run pytest
```

Useful variations:

```bash
uv run pytest -vv                                   # verbose
uv run pytest tests/test_screenshot.py              # one file
uv run pytest tests/test_screenshot.py::TestNormalizeUrl   # one class
uv run pytest -k copilot                            # match by name
uv run pytest --cov=routes                          # coverage
```

Type checking (must stay clean for files you touch):

```bash
uv run pyright
```

## Frontend

```bash
cd frontend
pnpm install
pnpm test        # jest unit tests
pnpm lint        # eslint, runs with --max-warnings 0
pnpm exec tsc --noEmit   # type check
```

`pnpm lint` reports a handful of pre-existing errors (mostly
`@typescript-eslint/no-explicit-any`). Those are baseline; just make sure your
change doesn't add new ones.

## Desktop app

The desktop shell is plain Node, so a syntax check catches most mistakes:

```bash
cd desktop
node --check main.js
node --check preload.js
```

To run the shell against the source tree (it starts the backend through uv and
loads `desktop/renderer` if present, otherwise the Vite dev server):

```bash
cd frontend && pnpm build && cd ..
Remove-Item -Recurse -Force desktop/renderer -ErrorAction SilentlyContinue
Copy-Item -Recurse frontend/dist desktop/renderer
cd desktop && npx electron .
```

Startup problems are written to the app log, which is the first place to look
when the window is blank or never appears:

```
%APPDATA%\shot2code-desktop\shot2code-backend.log
```

It records backend startup, renderer load failures, crashes and console errors.

## What to run before committing

- Touched backend code: `uv run pytest` and `uv run pyright`
- Touched frontend code: `pnpm exec tsc --noEmit` and `pnpm lint`
- Touched both: all of the above

Anything that changes how the UI is loaded (routing, asset paths, `window.open`)
should also be checked in the packaged app, not just `pnpm dev`. Several bugs
have only ever appeared under `file://`.
