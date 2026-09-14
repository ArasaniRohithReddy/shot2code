# Changelog

All notable changes to shot2code are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The released product version is the one in `desktop/package.json` — see
[docs/RELEASING.md](docs/RELEASING.md). Versions before 0.3.0 were not tracked
in this file; see the git history for those changes.

## [Unreleased]

Nothing yet.

## [0.3.2] - 2026-09-14

Released as [shot2code v0.3.2](https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.3.2).
Checksums for the published Windows artifacts:
[docs/releases/v0.3.2/SHA256SUMS.txt](docs/releases/v0.3.2/SHA256SUMS.txt).

This corrective release protects updates that start from an older client,
extends model selection to every supported code provider, and finishes the
responsive Preview and History experience.

### Fixed

- **Old clients can no longer replace a live backend.** The NSIS installer runs
  a pre-install safeguard before uninstalling or replacing the existing
  application. It identifies processes by executable path under the installed
  `resources\backend` directory, terminates each captured process tree
  synchronously, and verifies that no matching process remains. It never uses
  a process-name-wide kill, so unrelated processes with the same executable
  name are left alone.
- **Installer failure is closed and diagnosable.** If the installed backend
  tree cannot be confirmed stopped, replacement is aborted with an actionable
  interactive message or a silent-install exit code. Diagnostics are written
  to `%TEMP%\shot2code-installer-preinstall.log`.
- **Windows development consoles cannot crash prompt logging.** Prompt-preview
  diagnostics are encoded safely for the active output stream, including
  strict cp1252 consoles, instead of allowing Unicode box-drawing characters
  or prompt text to raise `UnicodeEncodeError` during generation.
- **The 100% preview no longer hugs the left edge.** Fixed-width desktop
  canvases are centred inside a neutral framed viewport; narrower windows
  retain deliberate horizontal scrolling without clipping the canvas start.
- **History is discoverable at every width.** User-facing navigation now says
  **History** consistently, with a separate labelled responsive destination
  beside Preview and Chat. History rows are keyboard-operable buttons with
  improved focus, target sizes and contrast.

### Added

- **Model selection for every code-generation provider.** Settings and the
  compact composer picker group available models under GitHub Copilot, OpenAI,
  Anthropic and Google Gemini. One option is generated for each selected model,
  subject to the existing per-run variant limit.
- **Credential-aware model catalogue API.** `/api/models` reports provider
  availability and model capabilities without returning secrets. Copilot
  models are discovered from the signed-in account; API-key providers use
  maintained, validated catalogues.
- **Safe selection migration and stale-model handling.** Existing
  `copilotModels` and non-default `codeGenerationModel` settings migrate into
  the provider-neutral `selectedModels` list. Removed credentials, retired
  models and unsupported media choices are reported explicitly.
- **Installer-level regression coverage.** Desktop tests cover NSIS wiring,
  installed process-tree shutdown, survival of unrelated same-name processes,
  failure-closed behavior and the application updater lifecycle.

### Changed

- Preview controls are grouped by purpose and use a clearer **Fit / 100%**
  segmented control plus a labelled **History n/m** control.
- Retries preserve the actual provider/model choices used by their source
  generation, and history records the concrete model for each variant.
- Public screenshots and documentation now show the centred Preview, History
  terminology, responsive destinations and multi-provider model interface.

## [0.3.1] - 2026-09-13

Released as [shot2code v0.3.1](https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.3.1).
Checksums for the published Windows artifacts:
[docs/releases/v0.3.1/SHA256SUMS.txt](docs/releases/v0.3.1/SHA256SUMS.txt).

A corrective release: it closes a race in the silent updater shipped in v0.3.0,
and reworks the workspace around the chat panel, the code editor and the
provider status the app can honestly report.

### Fixed

- **The updater could start a second installer.** Both install paths — the
  automatic one after a download and **Restart & install** in Settings — called
  `quitAndInstall` directly. A queued click, or `autoInstallOnAppQuit` firing
  during the quit that `quitAndInstall` itself triggers, could launch a second
  NSIS process while the first was already replacing files. There is now one
  guarded entry point (`desktop/update-lifecycle.js`): the in-progress flag is
  set **before** any blocking work, and `autoInstallOnAppQuit` is disabled for
  that explicit path so `app.quit` cannot start another installer behind it.
- **Backend shutdown is verified instead of assumed.** `taskkill` is bounded by a
  30-second timeout, its exit status is checked, and the process ID is re-probed
  to confirm the tree is actually gone. `stopBackend()` now reports success or
  failure rather than swallowing it, and an already-exited backend counts as
  stopped.
- **A failed shutdown aborts the install and stays retryable.** If the process
  tree cannot be confirmed dead, the update is not started at all — no more
  overwriting a live PyInstaller tree. The guard is released,
  `autoInstallOnAppQuit` is restored, and Settings reports *"The update was not
  started because shot2code could not shut down safely. Quit the app and try
  again."* instead of looking stuck.
- **`update-lifecycle.js` is packaged.** It is listed in the electron-builder
  `files` array, so the new install path ships inside the app rather than being
  dropped from the build.

### Added

- **Collapsible chat panel.** On wide layouts (≥ 1280px) the conversation column
  can be hidden so the preview or code editor takes the full width. The choice
  is remembered, **Ctrl+3** toggles it, and **Ctrl+1** / **Ctrl+4** bring it
  back.
- **Conversation empty state with starters.** A new project offers three
  starting points — *Make the layout responsive*, *Fix accessibility issues*,
  *Polish spacing and typography* for imported code, and *Match the reference
  more closely*, *Make the layout responsive*, *Add the missing interactions*
  for a generated first version. They are real buttons that **insert** the full
  instruction into the composer so you can edit it; nothing is sent on your
  behalf. A shortcut to read the source in the Code tab sits below them.
- **Provider status callout.** Replaces the old onboarding note and only states
  what the browser can actually see: *"No model provider saved in this browser"*
  with the reminder that shot2code will first try credentials it cannot see from
  here (a GitHub Copilot sign-in, or a key in `backend/.env`), or *"… saved on
  this device"* once a key exists. It never claims a provider is connected or
  verified. Actions: **Add a key in Settings** and **Setup guide**.
- **Format action in the Code tab.** A whitespace-only formatter for HTML, CSS,
  JavaScript and JSON. It is never automatic, it never evaluates the file, it
  refuses component source (JSX/TSX/Vue) rather than rewriting it, and it bails
  out unchanged on ambiguous or unbalanced syntax — so exports keep their
  original bytes.
- **Collapsible project file explorer** with a remembered preference, defaulting
  to open only when a project has more than one file.
- **Editor status bar** showing the language and line count (for example
  *"HTML · 26 lines"*), the keyboard hint *"Tab moves focus outside the editor;
  Ctrl+] indents."*, and the reason CodePen is unavailable as a polite
  `role="status"` message instead of a banner above the code.
- **Read-only** and **Generated** badges next to the existing **Entry** and
  **Preview** badges, so it is obvious why a saved version cannot be edited.
- New tests: `desktop/update-lifecycle.test.js` (installer guard and shutdown
  failure, via `node:test`), plus frontend tests for the icon rail, the
  conversation empty state, provider status wording, and the formatter.

### Changed

- The icon rail's **Editor** entry is now **Chat**, with an explicit
  collapse/expand control. Rail buttons carry `aria-label`s, `aria-pressed`,
  `aria-controls` and `aria-expanded`, decorative icons are hidden from
  assistive technology, and every target is at least 44px.
- Code tab toolbar labels were shortened to **Format**, **Copy**, **Download**
  and **CodePen**; the full descriptions moved into their accessible names.
- File tabs appear only when a project has more than one file, and the active
  tab is underlined rather than merely tinted.
- The editor highlights the active line and gutter, uses theme-correct surfaces
  for both the light and dark editor themes, and a tuned monospace scale.
- The variants strip is rendered only when a version actually has more than one
  variant.

## [0.3.0] - 2026-09-13

Released as [shot2code v0.3.0](https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.3.0).
Checksums for the published Windows artifacts:
[docs/releases/v0.3.0/SHA256SUMS.txt](docs/releases/v0.3.0/SHA256SUMS.txt).

This release turns shot2code into a local-first project workspace: your projects
and their version history are saved on your own machine, generated output is a
real multi-file project you can edit, and previews run in a locked-down sandbox.

### Added

#### Local project history (SQLite)

- Projects, versions and prompts are stored in a local SQLite database,
  `history.sqlite3`, instead of living only in the browser tab.
- The database lives in a per-user data directory —
  `%LOCALAPPDATA%\shot2code\` on Windows,
  `~/Library/Application Support/shot2code/` on macOS, and
  `$XDG_DATA_HOME` (or `~/.local/share`) `/shot2code/` on Linux. The location can
  be overridden with `SHOT2CODE_DATA_DIR` or `SHOT2CODE_HISTORY_DB_PATH`.
- Versioned schema with tracked migrations (`projects`, `commits`, `variants`,
  `prompts`, `variant_messages`), served over a new `/api/history` route group
  (list, load, rename, append version, update selection, delete).
- A **Recent projects** panel restores earlier work. Deleting a project removes
  it and every saved version from the device; nothing is uploaded anywhere.
- Saves are debounced so ordinary typing and generation do not thrash the disk.

#### Retry ancestry

- Commits record both `parent_commit_id` and `retry_of_commit_id`, so a retried
  AI version keeps a link to the version it re-rolls rather than looking like an
  unrelated branch.
- Retrying a version reuses the models that produced the original variants, and
  ancestry walks detect and reject cycles instead of looping.

#### Multi-file editor and project tree

- The Code tab is now a project view: a keyboard-navigable file tree
  (`role="tree"`, expandable folders, read-only files announced as such) beside
  file tabs with arrow-key navigation.
- Edits are per file across the whole project, with the resolved project entry
  point badged in the tab strip and per-file copy/download actions.
- The file tree is the authoritative source for export, CodePen and preview.

#### Safe, sandboxed previews

- Preview documents render from `srcDoc` in an iframe with
  `allow-scripts allow-forms allow-modals allow-downloads` — deliberately
  **without** `allow-same-origin`, so the preview runs in an opaque origin and
  cannot reach app state, cookies or storage.
- Previews are additionally constrained with an injected Content-Security-Policy
  meta tag, `referrerPolicy="no-referrer"`, and a permissions `allow` list that
  denies camera, microphone, geolocation and display capture.
- Select-and-edit no longer touches the parent window directly. It talks over a
  per-preview message bridge where every message must carry the matching channel
  and a random per-preview nonce, and selection payloads are size-capped.
- When a framework build or a local asset cannot be represented honestly in a
  self-contained document, the preview shows a deterministic fallback and
  diagnostic instead of a silently broken page; all source files remain editable
  and downloadable.

#### Import, export and CodePen across all 12 stacks

- **Import** an existing project from a folder, a ZIP archive, or selected source
  files. The scanner detects the likely framework from package metadata, source
  files and CDN tags by parsing text only — it never executes project code or
  loads configuration modules such as `tailwind.config.*`.
- Import is bounded by explicit limits (30 MB archive, 5,000 archive entries,
  400 scanned files, 600 KB per file, 8 MiB of decoded text), rejects path
  traversal, and ignores dependency and build-output directories.
- After inspection, choose **Use as design context** (only the compact summary is
  persisted) or **Open editable project** (the normalized files are handed to the
  editor for that session; raw source is not persisted).
- **Export** supports every one of the 12 stacks in both modes: a single
  self-contained HTML file, or a project folder with an explicit, documented
  per-stack strategy. React and Preact produce a real Vite project when the
  canonical module can be lifted safely, and a documented Vite HTML fallback when
  it cannot — no invented scaffolds.
- Multi-file source projects are exported as-is: existing package and framework
  configuration is preserved, and a project with no usable root build command
  keeps every file plus a **Safe fallback** note.
- **CodePen** sharing is offered only when the selected stack can honestly run in
  a browser-only Pen. Unsupported cases report why (fallback preview, omitted
  dependency, local runtime reference, unsupported script order, stack mismatch),
  and sharing always asks for confirmation first because code leaves the device.
- A separate validator builds archives for all 12 stacks plus preserved
  multi-file React, Preact and Vue payloads with a real `npm install` and
  `npm run build`.

#### Multi-screenshot modes

- Uploading more than one screenshot now asks **How are these screenshots
  related?** with four explicit modes: `pages` (separate pages), `responsive`
  (one page at several breakpoints), `states` (one interface moving between
  states), and `references` (screenshot 1 is the target, the rest clarify).
- `pages` is the default, including when a request omits the mode, and it
  requires every screenshot to be represented.
- The chosen mode is saved with the project and sent with each generation.

#### Responsive layout, accessibility and keyboard shortcuts

- A shortcut reference dialog (**Ctrl+/**) documents every binding, grouped by
  Project, Workspace and Help, and renders Mac key symbols on macOS.
- Conflict-free project shortcuts: **Ctrl+Alt+N** new project, **Ctrl+Alt+I**
  import, **Ctrl+Alt+U** upload, **Ctrl+Alt+S** settings, **Ctrl+Alt+E** export,
  **Ctrl+Shift+Enter** retry the selected version, and **Ctrl+1–4** for Preview,
  Code, Chat and Versions.
- Navigation shortcuts stand down while you are typing or while a dialog is open,
  and key repeat is ignored.
- Accessibility work across the workspace: ARIA tree semantics for the file
  explorer, labelled tab lists with managed focus, labelled import regions and
  progress, and larger touch targets and responsive breakpoints in the shared UI
  primitives.

#### GitHub Copilot model discovery

- shot2code asks the signed-in Copilot account which models it can actually use
  and records whether each one supports vision, instead of shipping a hardcoded
  list. Models that cannot read images are not offered, because turning a
  screenshot into code requires image input.
- Select several models and each generation produces one variant per model;
  leave them unchecked to let shot2code choose.
- Credentials are resolved without persisting or logging a token; cached results
  are keyed by a SHA-256 fingerprint of the credential.

#### Desktop updater and packaging

- Auto-update runs against the public GitHub Releases feed for per-user NSIS
  installs, with the version, update state and download progress surfaced in
  Settings alongside **Check now** and **Restart & install**.
- Updates install silently and relaunch instead of opening the NSIS wizard and
  waiting for a click.
- The bundled backend process tree (Python, Copilot CLI, Chromium) is terminated
  synchronously before the installer runs, so an update can no longer replace a
  live PyInstaller tree and leave native modules missing.
- Managed installs are detected: under Program Files (the MSI layout) the app
  disables self-update and says upgrades are administrator-controlled.
- Windows builds ship as NSIS `.exe` (+ `.blockmap`), `.msi` and portable `.zip`,
  with the backend frozen by PyInstaller and only `chromium-headless-shell`
  bundled, since the app always launches headless.
- The tag-triggered workflow builds all three formats but never publishes:
  releases are cut from a locally verified build, because CI publishing replaced
  `latest.yml` independently of the binaries and broke auto-update.

### Security

- Preview documents run in an opaque origin under a restrictive CSP, with the
  select-and-edit bridge accepting only channel- and nonce-matched messages.
- Imported projects are parsed as text only and are never executed; the scanner
  rejects traversal paths and enforces count, size and total-text limits.
- Raw imported source is never written to persisted project context — only the
  bounded summary is stored.
- CodePen sharing requires explicit confirmation before any code leaves the
  device.

[Unreleased]: https://github.com/ArasaniRohithReddy/shot2code/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/ArasaniRohithReddy/shot2code/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.3.1
[0.3.0]: https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.3.0
