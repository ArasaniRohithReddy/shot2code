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

**Copilot shows "Not signed in" even though the CLI works**

shot2code looks for, in order: a token in Settings, `COPILOT_GITHUB_TOKEN` /
`GH_TOKEN` / `GITHUB_TOKEN`, a stored `copilot` login, then a `gh auth login`.
If none are found, sign in again and restart the app so the check re-runs.

You can also paste a fine-grained token with the **Copilot Requests** permission
into Settings.

**No Copilot models are listed**

Only models that accept images are shown, because turning a screenshot into code
requires image input. If the list is empty, your plan may not currently include
a vision-capable model.

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
and the app simply skips that tool.

## Running from source

**UTF-8 errors on Windows** - open `backend/.env` in an editor that can save as
UTF-8 (Notepad++: Encoding → UTF-8) and re-save.

**Using an OpenAI proxy** - set `OPENAI_BASE_URL` in `backend/.env` or in
Settings. The URL must include `v1`, e.g. `https://xxx.example.com/v1`.

**Pointing the frontend at a different backend** - set `VITE_HTTP_BACKEND_URL`
and `VITE_WS_BACKEND_URL` in `frontend/.env.local`.
