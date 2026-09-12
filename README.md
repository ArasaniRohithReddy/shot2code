# shot2code

Turn screenshots, mockups, designs and screen recordings into clean, working
code — using AI, on your own machine.

shot2code is a **desktop app for Windows**. Everything runs locally: your
screenshots, your code and your API keys never leave your computer.

## Install

Download the latest build from
[Releases](https://github.com/ArasaniRohithReddy/shot2code/releases/latest):

| File | Use |
|---|---|
| `shot2code-<version>-x64.exe` | **Recommended.** Installer with shortcuts |
| `shot2code-<version>-x64.msi` | Per-machine managed deployment; updates are administrator-controlled |
| `shot2code-<version>-x64.zip` | Portable — unzip and run `shot2code.exe` |

> **Windows will warn you.** The builds aren't code-signed, so you'll see
> *"Windows protected your PC"*. Click **More info → Run anyway**, or right-click
> the file → **Properties** → **Unblock** → **Apply**. See
> [Troubleshooting](Troubleshooting.md).

First launch takes about a minute while the bundled backend starts. Later
launches are quicker.

NSIS-installed builds check GitHub Releases automatically. Settings shows the
running version, update status, download progress, **Check now**, and
**Restart & install** when an update is ready. Updates install silently after
the backend, Copilot CLI and Chromium process tree has fully stopped. MSI
installs are per-machine and leave upgrades to the administrator.

## Using it

Give shot2code a screenshot, several related screenshots, a URL, a text
description, or a screen recording, and it generates a working page. It
produces several variants in parallel so you can pick the best one, then refine
it by describing what to change.

Supported output stacks:

- HTML + Tailwind
- HTML + CSS
- React + Tailwind
- Vue + Tailwind
- Bootstrap
- Ionic + Tailwind
- Alpine.js + Tailwind
- Preact + Tailwind
- Tailwind + daisyUI
- Bulma
- Material 3
- htmx + Tailwind

Other things it can do:

- **Select an element and edit it** by describing the change
- **Version history** — every generation is a commit you can step back through
- **Screenshot preview** — the agent renders its own output in a headless
  browser and visually checks its work
- **Asset extraction** — reuses the real logos and images from your screenshot
  (needs a Gemini key)
- **Image generation and editing** (needs a Replicate key)
- **Existing-project context** — choose a folder, ZIP, or source files and
  shot2code extracts component names, props, dependencies and design tokens
  without executing the project. The compact summary guides later generations.
- **Multi-screenshot modes** — choose whether screenshots are separate pages,
  responsive views, UI states, or supporting references. Separate pages is the
  default, and every screenshot must be represented.
- **Project export** — React and Preact become real Vite projects; other stacks
  export as separate HTML, CSS and JavaScript files.

### Multiple screenshots

When more than one screenshot is uploaded, shot2code asks how they relate:

| Mode | Behaviour |
|---|---|
| Separate pages | One navigable route/view per screenshot; none may be omitted |
| Responsive views | One page, with breakpoints inferred from the screenshots |
| UI states | One interface with interactions that move between the states |
| Supporting references | Screenshot 1 is the target; the rest clarify details |

### Use an existing project as context

Open **Import → Existing project context** and choose:

- A project folder
- A ZIP archive
- Selected source files

shot2code ignores `node_modules`, build output, binaries and oversized files. It
does not execute configuration or application code. Only a bounded summary is
stored on the device and sent as design context; raw source files are discarded
after analysis. The active project appears above every input tab and in
Settings, where it can be cleared.

## Choosing a model

You need **one** provider. GitHub Copilot is easiest because it needs no API key.

| Provider | Setup | Notes |
|---|---|---|
| **GitHub Copilot** ⭐ | `gh auth login` (or `copilot`) — needs an active Copilot subscription | Claude, GPT, Gemini and Grok through one sign-in |
| Gemini | API key | Also powers asset extraction and **video input** |
| Anthropic | API key | |
| OpenAI | API key | |
| Replicate | API key | Image generation, editing, background removal |

Keys go in **Settings** (gear icon) and are stored on your device only.
Replicate is the exception — it must be set in `backend/.env`.

### GitHub Copilot

shot2code uses the official
[GitHub Copilot SDK](https://github.com/github/copilot-sdk), which finds
credentials in this order:

1. A token in Settings
2. `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`
3. A stored `copilot` CLI login
4. A stored `gh auth login`

So if you already use the GitHub CLI, it just works — Settings shows which
account was picked up. Otherwise create a fine-grained token with the
**Copilot Requests** permission.

Settings lists the models your plan actually offers. Tick the ones you want and
each generation produces one variant per selected model; leave them unchecked to
let shot2code choose. Models that can't read images are hidden, since turning a
screenshot into code requires image input.

## Running from source

Requires [uv](https://docs.astral.sh/uv/), [pnpm](https://pnpm.io/) and Node 18+.

```bash
# Backend
cd backend
uv sync
uv run playwright install chromium      # optional: screenshot preview
uv run uvicorn main:app --reload --port 7001

# Frontend (in another terminal)
cd frontend
pnpm install
pnpm dev
```

Open http://localhost:5173.

On macOS/Linux, `bash scripts/install.sh` installs everything in one go.

### Docker

```bash
echo "GEMINI_API_KEY=your-key" > .env
docker-compose up -d --build
```

For a much smaller image without the screenshot-preview tool:

```bash
docker build --build-arg INSTALL_CHROMIUM=false -t shot2code-backend ./backend
```

### Building the desktop app

```bash
cd frontend && pnpm build && cd ..
cd backend && uv run pyinstaller shot2code-backend.spec --noconfirm --distpath dist-pyinstaller
PLAYWRIGHT_BROWSERS_PATH=backend/dist-pyinstaller/shot2code-backend/ms-playwright \
  uv run --project backend playwright install chromium-headless-shell

cp -r frontend/dist desktop/renderer
cp -r backend/dist-pyinstaller/shot2code-backend desktop/backend-dist

cd desktop && npm install && npx electron-builder --win nsis zip --publish never
```

Pushing a `v*` tag builds and publishes all three formats to Releases via
GitHub Actions.

## Documentation

- [Troubleshooting](Troubleshooting.md) — install warnings, blank windows, sign-in
- [Testing](TESTING.md) — how to run tests and type checks
- [Evaluation](Evaluation.md) — comparing models and prompts
- [design-docs/](design-docs/) — how the agent, variants and history work
- [AGENTS.md](AGENTS.md) — conventions for working in this repo

## Architecture

A React + Vite frontend and a FastAPI backend. Generation streams over a
WebSocket; everything else is plain HTTP. In the desktop app, Electron starts
the backend on a free local port and passes the URL to the UI.

The backend runs an agent loop: the model calls tools (`create_file`,
`edit_file`, `extract_assets`, `screenshot_preview`, image tools) and shot2code
executes them and feeds results back. Providers live in
`backend/agent/providers/`.

## License

MIT
