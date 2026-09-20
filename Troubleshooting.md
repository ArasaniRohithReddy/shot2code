# Troubleshooting

## Installing the app

**"Windows protected your PC" when running the installer**

shot2code isn't code-signed, so Windows flags it. Either:

- Click **More info** then **Run anyway**, or
- Right-click the `.exe` → **Properties** → tick **Unblock** → **Apply**, then run it

Windows tags every downloaded file with a "mark of the web"; this is that, not a
problem with the download.

**The installer seems to do nothing**

It unpacks roughly 600 MB, so it can sit for a minute before showing progress.

**An automatic update downloaded, but a Setup window is waiting**

Versions up to v0.2.0 launched the interactive NSIS wizard after downloading.
Complete that wizard once. v0.2.1 and later stop the backend/browser process
tree first, install silently, and restart automatically. Settings shows the
installed version and current update state.

**"Backend did not become ready in time" after an automatic update**

An older updater could replace files before the bundled backend and Chromium
processes had fully exited, leaving native Python modules missing. Re-run the
latest installer manually (right-click → **Properties** → **Unblock** first).
v0.2.1 fixes the shutdown ordering so later updates cannot partially replace
the backend.

**The MSI says updates are managed by an administrator**

That is intentional. MSI is the per-machine deployment format and does not use
the self-updater. Use the recommended `.exe` installer for per-user automatic
updates.

## Starting the app

**The window takes a while on first launch**

A cold start boots the bundled Python backend and probes Chromium and Copilot.
The splash screen stays up until the backend answers. Later launches are faster
because the Copilot check is cached.

**The window is blank, or never appears**

Check the log:

```
%APPDATA%\shot2code-desktop\shot2code-backend.log
```

It records backend startup, renderer load failures, crashes and console errors.
Include the tail of that file if you open an issue.

## Generating code

**"No API key found and no GitHub Copilot credentials detected"**

You need one of:

- A GitHub Copilot subscription. Run `gh auth login` (or `copilot`) once in a
  terminal, then restart shot2code. Settings shows which account it picked up.
- An API key for OpenAI, Anthropic or Gemini, entered in Settings.
- A separate **GitHub Copilot SDK BYOK** connection for an OpenAI-compatible,
  Azure OpenAI or Anthropic endpoint. BYOK does not require a Copilot
  subscription and never borrows the direct provider keys.

**Copilot shows "Not signed in" even though the CLI works**

shot2code looks for, in order: a token in Settings, `COPILOT_GITHUB_TOKEN` /
`GH_TOKEN` / `GITHUB_TOKEN`, a stored `copilot` login, then a `gh auth login`.
If none are found, sign in again and restart the app so the check re-runs.

You can also paste a fine-grained token with the **Copilot Requests** permission
into Settings.

**"Sign in with GitHub" says no CLI was found**

That button runs the official CLI's own browser sign-in rather than an OAuth
flow of its own, so it needs either GitHub Copilot CLI or the GitHub CLI on your
`PATH`. Settings links to GitHub's install instructions. Install one, then try
again — or sign in with `copilot` / `gh auth login` in a terminal, which has the
same result.

**The sign-in browser window opened but nothing happened**

Finish the flow in the browser, then return to shot2code; it re-checks your
credentials when the CLI exits. If you closed the browser, use **Cancel** and
start again. The flow times out on its own, and it is always stopped when the
app closes, so it cannot be left running in the background. shot2code never sees
the token — the CLI stores it — so if sign-in succeeded but Settings still shows
nothing, check that the account actually has a Copilot subscription.

**A provider check fails but generation used to work**

Use the per-provider check in Settings; it makes one deliberately tiny — though
still potentially billable — request and names the category:

- **credentials** — the key is wrong or revoked. Re-paste it.
- **billing** — the account has no credit left, so add credits or fix billing on
  the provider's dashboard. An OpenAI account with no remaining credit reports
  this, not a generic error.
- **quota** — rate limited. Wait, or select fewer models.
- **permissions** — the account cannot use that model; enable it with the
  provider or choose another.
- **model** — the model id is unknown to that provider, or the model cannot do
  what shot2code needs (image input and tool calling).
- **network** — the endpoint is unreachable; check proxies and firewalls.
- **configuration** — something is missing before a request can be made.

**A check with a custom OpenAI base URL says it needs its own API key**

That is deliberate. The key the backend was started with belongs to the
backend's own endpoint, and is never sent to an address the request names. Put
the key for that endpoint in the same request (Settings does this for you). The
URL must also be `https` unless it points at localhost, and must not embed a
username or password.

**No Copilot models are listed**

Only models that accept images are shown, because turning a screenshot into code
requires image input. If the list is empty, your plan may not currently include
a vision-capable model.

**No Copilot SDK (BYOK) models are listed**

Open **Settings → GitHub Copilot SDK BYOK**. The connection must be switched on
and usable. Azure OpenAI needs its resource endpoint and a dedicated API key or
bearer token. Remote OpenAI-compatible and Anthropic endpoints need their own
credential; only an OpenAI-compatible endpoint on `localhost` may omit one.
There is no Gemini BYOK provider in the Copilot SDK.

Configuring BYOK never unlocks or re-routes the native OpenAI or Anthropic
groups. Those still need their own direct keys.

**My endpoint's model list is empty, or "listing is not available"**

`/models` is optional. shot2code asks an OpenAI-compatible endpoint for its list
and shows what comes back; when the endpoint does not implement that route it
says so and you type the model name into **Model / deployment** instead. Azure
OpenAI and Anthropic never list models this way, so their model name is always
manual. If the listing fails for a real reason — a rejected key, an unreachable
host — the message says which; shot2code will not invent a list.

**My endpoint's model does not appear in the picker**

Name it in **Model / deployment**. That publishes exactly that one model under
its real name rather than a vendor family. The name may be up to 128 characters
and may contain slashes, colons, dots and `@`, but no spaces — use the id the
endpoint itself reports. If a check says the endpoint does not list it, pick one
of the ids it does report.

**A BYOK generation fails on tools or images**

shot2code drives the model with screenshots and tool calls, so a BYOK model
needs **image input (vision) and tool calling**. A successful connection check
only proves the endpoint answered; it cannot prove those capabilities, which is
why the requirement is repeated with the result. An endpoint that rejects a tool
or an image is reported as a model problem — choose a model that supports both.

**A BYOK request went to the wrong API**

A connection with its own base URL uses Chat Completions by default, because
that is what compatible endpoints implement. A vendor connection with no base
URL of its own uses Responses. Set **Wire API** explicitly if your endpoint
needs the other one.

**A BYOK retry ran through the wrong provider**

Versions created by v0.4.0 record identities such as
`sdk-byok/azure/gpt-5.6-sol (high thinking)`, or
`sdk-byok/openai/custom/your-model` for a model only your endpoint knows, so
retries preserve the runtime as well as the model. A retry replays that identity
using whatever the connection is configured with today, so if you repoint the
endpoint at a different model the old identity stops resolving and you should
re-select it in **Models**. If a version predates identities entirely, choose
the BYOK entry explicitly before retrying.

## MCP servers

**A configured MCP server does not run**

The server must be both **Enabled** and **Trusted**. Stdio servers also need a
command; HTTP and SSE servers need an HTTPS URL unless they point at localhost.
Use **Validate servers** to see configuration diagnostics. Validation does not
start the server or contact its endpoint.

**A write tool is rejected**

Trusted servers are read-only by default. Turn on **Allow write tools** only
when you intend that server to change files, data or remote state.

**My OpenAI, Anthropic or Gemini option cannot see MCP tools**

That is intentional. MCP tools are exposed only to GitHub Copilot subscription
and explicit Copilot SDK BYOK options. Native provider variants remain isolated
from the SDK runtime.

An unfinished, disabled or untrusted server draft is skipped with a notice and
does not block a direct-provider generation.

**An imported project has no components or tokens**

The scanner reads HTML, CSS, JavaScript, TypeScript, Vue, JSON, Markdown and
YAML. It deliberately skips `node_modules`, build output, binaries and large
files, and it never executes `tailwind.config.js` or any other project code.
Component discovery currently recognises exported React/TypeScript components
and `.vue` component files; CSS variables and reusable CSS classes become
design tokens.

**Only one of several screenshots appears in the result**

Upload the screenshots together and choose **Separate pages** in “How are these
screenshots related?”. That mode requires one navigable view per screenshot and
makes the model verify the view count. Use **Responsive views** only when the
images are the same page at different widths, and **UI states** for before/after
states such as an open modal.

**"Could not start screen recording"**

Screen capture needs the app to grant itself permission to the display. If this
still happens, check the log for a `screen capture` line - it records which
source was chosen or why the request failed.

## Features that need extra setup

**Image generation and editing** need a Replicate key. It has to go in
`backend/.env` as `REPLICATE_API_KEY`; it cannot be set from the UI.

**Video / screen-recording input** requires a Gemini key.

**Screenshot preview** (the agent rendering its own output to check it) needs
Chromium. It ships with the desktop app. If it's unavailable, Settings says so
and the app simply skips that tool. Running from source, install just the
headless shell and then use **Check again** in Settings — no restart needed:

```bash
cd backend
uv run playwright install chromium-headless-shell
```

## Review workspace

**A Review frame reports horizontal overflow**

The frame measures the rendered document at its labeled CSS width. Inspect
fixed-width elements, unwrapped tables and long unbroken content. Add a custom
width between 320px and 1920px when the problem occurs at a specific breakpoint.

**Review says the results are stale**

The version, selected option, source or viewport set changed after the audit.
Rerun it before exporting the report or inserting findings into Chat.

**The audit missed something**

The audit is deterministic and local, but it checks the composed source rather
than certifying the runtime experience. It is not WCAG certification; continue
with keyboard, screen-reader and browser testing.

## Settings and layout

**I cannot scroll to the final Settings controls**

Update to v0.4.0 or newer. Settings now owns a viewport-bounded scroll area in
both empty and active projects, so Screenshot by URL and every control below it
remain reachable. If an older build is stuck, close Settings, resize the window
or reduce zoom temporarily, then install the current release.

## Running from source

**UTF-8 errors on Windows** - open `backend/.env` in an editor that can save as
UTF-8 (Notepad++: Encoding → UTF-8) and re-save.

**Using an OpenAI proxy** - set `OPENAI_BASE_URL` in `backend/.env` or in
Settings. The URL must include `v1`, e.g. `https://xxx.example.com/v1`.

**Pointing the frontend at a different backend** - set `VITE_HTTP_BACKEND_URL`
and `VITE_WS_BACKEND_URL` in `frontend/.env.local`.
