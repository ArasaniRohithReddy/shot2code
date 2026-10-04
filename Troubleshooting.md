# Troubleshooting

For setup and expected behavior specific to **Upload, URL, Text, Import, Figma,
GitHub, and Stitch**, see the screenshot-led
[input-tab guide](docs/INPUT-TABS.md).

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

**"Sign in with GitHub" is unavailable in the browser development build**

The packaged desktop app needs no CLI: it runs shot2code's own GitHub device
flow and encrypts the token with the operating-system key store. The browser
development build cannot use that Electron bridge, so it delegates to GitHub
Copilot CLI or GitHub CLI and reports when neither is on `PATH`.

**The sign-in browser window opened but nothing happened**

Finish the flow in the browser, then return to shot2code; it re-checks your
credentials when the CLI exits. If you closed the browser, use **Cancel** and
start again. The flow times out on its own, and it is always stopped when the
app closes, so it cannot be left running in the background. The packaged app stores its own token encrypted; a delegated browser-development
login remains owned by the CLI. If sign-in succeeds but Settings still shows no
models, check that the account actually has a Copilot subscription and a
vision-capable model.

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

**Preview says `{IMG.dashboard}` or a brace-wrapped URL is a missing local file**

Older/generated markup sometimes used pseudo-image tokens such as
`{IMG.dashboard}` or placed a real `https://` URL inside braces. Browsers cannot
resolve those strings, so Preview treated them as project-relative paths and
CodePen refused to silently alter the project. Current builds forbid these
tokens in the generation prompt and repair known image-shaped cases in the
derived preview. Refine the affected version once if the source itself still
contains a token.

**CodePen says it cannot represent an asset**

CodePen receives browser-only HTML, CSS and JavaScript; it cannot carry a local
multi-file dependency that was omitted from the composed preview. Download the
Project folder when the warning names a real project file. A malformed
brace-token warning is different and is handled as described above.

**Pasting a screenshot into Chat does nothing**

Paste while the refinement textarea has focus. PNG, JPEG and WebP are accepted,
up to 10 MB each and five images per turn. Duplicate screenshots are ignored.
Text-only clipboard content is pasted normally. If the composer already has five
images, remove one of the preview thumbnails first.

**Figma imported the frame but not every asset**

Figma's file, image-fill and rendering endpoints share tight Tier 1 limits.
shot2code keeps the successful frame and reports optional asset failures
separately. Wait for the displayed `Retry-After` period, or export the missing
asset from Figma and add it through Upload. REST provides design structure and
assets, not production application source code.

**A Stitch screen imported without an image/font**

Only HTTPS assets with a supported image/font/stylesheet type are localized.
Private-address hosts, unsafe redirects, oversized files, MIME mismatches and
executable SVG content are refused. `STITCH-IMPORT.md` lists any partial-import
warning. Stitch remains a design generator; it is not a general image-provider
fallback.

**I want Stitch output without another AI model changing it**

Use the dedicated **Stitch** tab and leave **Stitch only** selected. shot2code
opens Stitch's localized HTML, screenshot, images, stylesheets, fonts and
available `DESIGN.md` directly. No Copilot, OpenAI, Anthropic or Gemini
conversion runs. Choose **Convert to selected stack** only when you explicitly
want another model to translate the design to React, Vue or another stack.

**A GitHub repository cannot be imported**

Use an `https://github.com/owner/repository` URL. Public repositories need no
token. A private repository needs a separate fine-grained token restricted to
that repository with **Contents: read** in Settings. Copilot sign-in is not
reused because its narrow scope does not authorize repository contents.
Repositories over 30 MB, unsupported binary-only repositories, traversal paths
and dependency/build folders are refused or skipped, and no repository code is
executed.

**Website design inspection is refused**

The inspector accepts only a public HTTP(S) page that resolves exclusively to
public internet addresses and loads without signing in. Localhost, private
networks, cloud metadata, credential-bearing URLs and private subrequests are
blocked. The result is rendered evidence and an inferred `DESIGN.md`, not the
site's original source code or a licence to copy its assets.

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

**Image generation and editing** need an image provider. Replicate is the
default: put `REPLICATE_API_KEY` in `backend/.env` or paste the key in
**Settings → Replicate API key**. Cloudflare Workers AI (account ID + API
token) and any OpenAI-compatible image endpoint are optional alternatives
configured in **Settings → Image Generation**; choosing one changes nothing
about your existing keys.

**"Generated 0 of 3 images"** means the provider answered but produced
nothing, and the reason is on each tile: rate limited (wait, or ask for fewer
images at once), no credit (top up on the provider's dashboard), bad
credentials (recheck the key), or a timeout (try again). A partially successful
batch keeps the images it did get and says how many.

**"Background removal runs on Replicate only"** is literal. No other provider
here has an equivalent endpoint and none is substituted, so `remove_backgrounds`
is not offered without a Replicate key — even when images are being generated
by Cloudflare or a custom endpoint.

**A custom Replicate model is refused** when its published schema says it does
not take a string `prompt`, does not return an image, or requires inputs
shot2code does not send. Replicate models do not share one input schema, so the
schema is checked rather than assumed.

**No image provider configured at all?** Turn on **Settings → Free image
search**. It needs no API key and no payment, and lets a model find real
CC0/public-domain photographs through Openverse. Results are restricted to
CC0 and Public Domain Mark so an exported project does not inherit an
attribution, share-alike or non-commercial obligation, and every image is
downloaded and served locally rather than hotlinked.

**"No free images found"** means Openverse had nothing matching that subject
under those two licences — far more of its index is CC-BY or share-alike, which
shot2code excludes. Try a broader subject. **"Found 1 of 3"** means the rest
were skipped because their URLs failed a safety check (a private address, a
mismatched content type, or a file over the size limit).

**"The model won't open a link"** is deliberate. Copilot's built-in `web_fetch`
is not offered, because the Copilot SDK hands a built-in's result straight to
the model and only tells shot2code afterwards — there is no point at which a
whole fetched page could be capped, marked untrusted or budgeted. Any URL the
Copilot runtime asks to open during a run is denied. Use **Web search (all
models)** in Settings instead: shot2code runs that search itself, so results
are capped, labelled and counted against a budget.

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
