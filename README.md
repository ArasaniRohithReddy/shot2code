# shot2code

Convert screenshots, mockups, Figma designs, and screen recordings into clean, functional code using AI.

Supported stacks:

- HTML + Tailwind
- HTML + CSS
- React + Tailwind
- Vue + Tailwind
- Bootstrap
- Ionic + Tailwind

## 🛠 Getting Started

shot2code has a React/Vite frontend and a FastAPI backend. Everything runs on
your machine — your screenshots and API keys never leave it.

### Prerequisites

- [uv](https://docs.astral.sh/uv/) for the Python backend
- [pnpm](https://pnpm.io/) and Node 18+ for the frontend

### Choosing a model provider

You need **one** of the following. GitHub Copilot is the easiest because it
needs no API key at all.

| Provider | Setup | What it unlocks |
|-----|-----------|-----------------|
| **GitHub Copilot** ⭐ | Just `gh auth login` (or `copilot`) — needs an active Copilot subscription | Claude, GPT, Gemini and Grok models through one sign-in, no API key |
| `GEMINI_API_KEY` | API key | Gemini variants; extracts real assets from the screenshot; **required for video mode** |
| `ANTHROPIC_API_KEY` | API key | Claude variants |
| `OPENAI_API_KEY` | API key | GPT variants |
| `REPLICATE_API_KEY` | API key | Image editing, background removal, image generation |

With more providers configured, shot2code automatically picks a stronger mix of
models per variant.

#### Using GitHub Copilot

shot2code talks to Copilot through the official
[GitHub Copilot SDK](https://github.com/github/copilot-sdk), which discovers
credentials in this order:

1. A token you paste into the Settings dialog
2. `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`
3. A stored `copilot` CLI login
4. A stored `gh auth login`

So if you already use the GitHub CLI, it works with no configuration. Settings
shows which account is signed in. To use a token instead, create a fine-grained
PAT with the **Copilot Requests** permission.

Copilot models appear in the model picker prefixed with `Copilot:`.

### Run the backend

```bash
cd backend
uv sync
# Install the Chromium browser used by the screenshot preview tool.
# On Linux, use `uv run playwright install --with-deps chromium`.
uv run playwright install chromium
uv run uvicorn main:app --reload --port 7001
```

API keys are optional in `backend/.env`:

```bash
echo "GEMINI_API_KEY=your-key" > .env
echo "REPLICATE_API_KEY=r8_your-key" >> .env
```

You can also set OpenAI, Anthropic, Gemini and GitHub tokens in the Settings
dialog (gear icon). Replicate must be configured in `backend/.env`.

> **Screenshot preview** (optional) lets the agent render its own generated page
> in a headless browser and visually check its work. It's enabled automatically
> once Chromium is installed. If Chromium is missing, the app just skips the
> tool — the Settings dialog shows whether it's available.

### Run the frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Open http://localhost:5173.

If you run the backend on a different port, update `VITE_WS_BACKEND_URL` in
`frontend/.env.local`.

## Docker

```bash
echo "GEMINI_API_KEY=your-key" > .env
docker-compose up -d --build
```

The app will be at http://localhost:5173. File changes won't trigger a rebuild
with this setup.

To build a much smaller backend image without Chromium (the screenshot preview
tool is then unavailable):

```bash
docker build --build-arg INSTALL_CHROMIUM=false -t shot2code-backend ./backend
```

## Development

```bash
cd backend && uv run pytest     # backend tests
cd backend && uv run pyright    # backend type check
cd frontend && pnpm test        # frontend tests
cd frontend && pnpm lint        # frontend lint
```

## 🙋‍♂️ FAQs

- **How do I get an OpenAI API key?** See [Troubleshooting.md](Troubleshooting.md).
- **How can I configure an OpenAI proxy?** Set `OPENAI_BASE_URL` in `backend/.env` or in the settings dialog. Make sure the URL has `v1` in the path, e.g. `https://xxx.xxxxx.xxx/v1`.
- **How can I change the backend host the frontend connects to?** Configure `VITE_HTTP_BACKEND_URL` and `VITE_WS_BACKEND_URL` in `frontend/.env.local`.
- **Seeing UTF-8 errors when running the backend?** On Windows, open `.env` with Notepad++, then go to Encoding and select UTF-8.

## License

MIT
