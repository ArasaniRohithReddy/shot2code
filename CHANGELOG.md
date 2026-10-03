# Changelog

All notable changes to shot2code are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The released product version is the one in `desktop/package.json` — see
[docs/RELEASING.md](docs/RELEASING.md). Versions before 0.3.0 were not tracked
in this file; see the git history for those changes.

## [Unreleased]

## [0.6.0] - 2026-10-04

Released as [shot2code v0.6.0](https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.6.0).
Checksums: [docs/releases/v0.6.0/SHA256SUMS.txt](docs/releases/v0.6.0/SHA256SUMS.txt).

### Added

- **Design-source asset preservation.** Figma imports now keep original image
  fills and export-marked nodes as durable local assets. Google Stitch imports
  localize the SDK's HTML, screenshot, referenced images, stylesheets, fonts and
  available `DESIGN.md` into an editable multi-file project. Source-asset names
  and URLs survive History, retries and later chat refinements, and binary files
  are decoded correctly in Preview and project ZIP exports.
- **Stitch-only delivery.** The dedicated Stitch tab defaults to opening
  Stitch's localized HTML, assets, screenshot and `DESIGN.md` directly, with no
  second model call or provider quota. Converting to the selected shot2code
  stack is a separate explicit mode.
- **Public website design inspection.** The URL tab can inspect a public site in
  local Chromium without a ScreenshotOne key, extracting computed colors,
  typography, spacing, radii, shadows, motion, semantic components,
  accessibility structure and public asset references. It captures desktop,
  tablet and mobile evidence and can copy/download an editable `DESIGN.md` or
  use that file plus the screenshots for generation. Requests are bounded and
  private/loopback/metadata addresses are refused.
- **GitHub repository import.** A dedicated tab downloads a repository archive,
  routes it through the existing never-execute scanner, preserves bounded image
  assets, detects the frontend stack and opens the result as an editable
  project. Public repositories need no token. Private repositories require a
  separate fine-grained token restricted to that repository with
  `Contents: read`; the narrow Copilot sign-in is never silently reused.
- **Paste screenshots into refinement chat.** Clipboard PNG, JPEG and WebP
  images enter the existing update-image flow without interfering with normal
  text paste. Duplicate images are ignored, each file is capped at 10 MB, and a
  turn may contain at most five reference images.
- **A new application identity.** The generic purple code-frame icon has been
  replaced by an original dark capture-to-code `2` mark. One reproducible
  generator produces the Windows multi-resolution ICO, desktop PNG, web
  favicon and active/coding favicon, with tests preventing them from drifting.

### Changed

- Google Stitch remains an additive UI/design generator and asset source. Its
  documented SDK exposes screen generation, edits, variants, HTML, screenshots
  and design-system data, but not a general-purpose image API or an
  authoritative recurring free quota; shot2code therefore does not present it
  as a Replicate replacement or promise that it is free.
- Website and repository imports are explicit, read-only capture operations.
  Capture credentials and repository tokens are stripped from generation and AI
  review payloads, project History and exported reports.

### Fixed

- Generated brace placeholders such as `{IMG.dashboard}` and brace-wrapped
  public URLs no longer become misleading "missing local file" errors.
  Prompts forbid them, while the derived preview safely unwraps real URLs and
  substitutes an honest placeholder for unresolved image tokens so CodePen does
  not reject otherwise portable output.
- Pasted/imported binary assets are no longer exported as base64 text files.
- Packaged eval favicon changes now use relative `file://`-safe paths.
- Windows now sets its explicit AppUserModelID so taskbar grouping, shortcuts
  and notification identity stay aligned with the packaged executable.

## [0.5.2] - 2026-09-28

Released as [shot2code v0.5.2](https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.5.2).
Checksums for the published Windows artifacts:
[docs/releases/v0.5.2/SHA256SUMS.txt](docs/releases/v0.5.2/SHA256SUMS.txt).

### Added

- **Free image search — shot2code sends no key of its own.** A new canonical
  `search_free_images` tool finds real, ready-to-use photographs through
  Openverse's public image API, and is offered to every runtime. It needs no
  credential, so it works on a machine with **no** Replicate, Cloudflare or
  OpenAI-compatible configuration at all, and configuring one of those never
  switches it off. It is a *separate* tool from `generate_images`, never a
  silent fallback inside it: the model picks whichever the design needs, and
  the activity feed says "Found 3 free images" rather than "Generated". Off by
  default, because the query text leaves the machine.
- Free image results are restricted to **CC0 and Public Domain Mark**, so an
  exported project cannot quietly inherit an attribution, share-alike or
  non-commercial obligation shot2code could not enforce on the user's behalf.
  The licence is re-checked locally rather than trusting the search server's
  filter, and a result missing its source page or licence URL is dropped
  because it could not be verified. Title, creator, source page, provider,
  licence name and licence URL travel with every image, along with an explicit
  warning that Openverse aggregates other platforms' metadata and should be
  verified before commercial use.
- Found images are downloaded and served locally, so generated and exported
  projects never hotlink somebody else's server. Every URL is checked first:
  `http(s)` only, DNS-resolved with private, loopback, link-local and cloud
  metadata addresses refused (a mixed answer is rejected outright as a
  rebinding attempt), redirects re-validated rather than followed, declared
  content type required to match the sniffed bytes within an image allowlist,
  and byte and decoded-pixel ceilings enforced. Web image search is
  deliberately not used: a picture on a web page grants no reuse right.

- **Optional image-generation providers.** Placeholder images can now be
  generated by Cloudflare Workers AI (account ID + API token) or by any
  OpenAI-compatible image endpoint (base URL, plus an API key unless it runs on
  localhost), in addition to Replicate. The alternatives are *additive*:
  Replicate stays the default and the existing Replicate, OpenAI, Anthropic and
  Gemini keys are never read, replaced or re-routed by the choice. Cloudflare's
  daily allocation is quoted from Cloudflare's own pricing page — 10,000
  Neurons a day on **both** the Workers Free and Workers Paid plans, resetting
  at 00:00 UTC, $0.011 per 1,000 Neurons above it — attributed to the user's
  Cloudflare account, dated, and marked able to change, never as a guarantee.
  `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` supply the same
  credentials to headless runs.
- Both validated Replicate image models are now selectable —
  `prunaai/z-image-turbo` (default) and `black-forest-labs/flux-2-klein-4b` —
  each with cost wording that names who bills, quotes the provider's own
  published figure with the date it was read, links that provider's pricing
  page, and says the terms can change. No provider is described as permanently
  free anywhere in the product.
- **Checked custom Replicate models.** Another Replicate model can be used once
  it passes a schema check: `POST /api/image-models/validate` reads that
  model's own published OpenAPI schema and accepts it only if it really
  declares a string `prompt` input and an image output and requires nothing
  else. Replicate models do not share one input schema, so no model outside the
  curated list is claimed to be compatible without that evidence.
- `GET /api/image-models` exposes the curated catalog — providers, defaults,
  capabilities and cost notes — as a pure read that carries no credential.
- **Provider-neutral web search.** A shot2code-owned `search_web` tool is now
  offered to every runtime — native OpenAI, Anthropic and Gemini, GitHub
  Copilot and Copilot SDK BYOK — instead of only to Copilot SDK sessions.
  Tavily is the default provider (its published plan is 1,000 API credits a
  month with no credit card, plus a documented keyless trial that needs no
  account); Exa is available as an alternative and always needs a key. Those
  allowances are the providers' own and can change — shot2code links their
  pricing pages rather than promising anything. Off by default; Settings
  states exactly what leaves the device before it can be switched on, and
  offers a test-connection button.
- Web search requests go only to the provider's fixed HTTPS endpoint, with an
  explicit timeout, no redirects and no raw page content. Each search returns
  at most 5 results with bounded titles, snippets and total size, prefixed with
  an untrusted-content warning, and is capped at 3 searches per turn and 10 per
  generation. Search-provider keys are backend-only and are excluded from
  history, commit snapshots and tool arguments.
- Copilot's built-in `web_search` remains available for people who prefer it
  and have the entitlement. When the canonical search is configured and usable,
  it is enabled *instead of* the built-in, so a model can never take the
  unbounded route past the budgets and the domain allowlist.
- Google Stitch generation now reports real SDK phases — connecting, project
  creation, screen generation, output download and import — with elapsed time,
  an accessible live status and bounded error messages. The SDK client now uses
  the same ten-minute generation timeout the UI promises.
- Dedicated **Figma** and **Stitch** input destinations sit beside Upload, URL,
  Text and Import. Figma uses its documented REST/PAT frame-rendering path;
  Stitch uses the bundled experimental SDK and preserves the selected
  shot2code stack/model routing.
- The Preview toolbar now includes accessible 25%–200% desktop canvas zoom,
  Fit and 100% controls. Magnified canvases pan without blocking iframe
  interaction.
- Help now includes an in-app Bug, Feature request and Feedback form with
  authenticated `gh` submission plus copy, Markdown-download and prefilled
  browser fallbacks.

### Changed

- **Copilot's built-in `web_fetch` is assessed and deliberately not offered.**
  It is a real runtime built-in and `ToolSet.add_builtin("web_fetch")` would
  reach it, but a built-in's result is produced inside the Copilot runtime and
  handed to the model by the runtime — the SDK only notifies the application
  afterwards. There is therefore no point at which shot2code could cap that
  text, mark it as untrusted, or count it against a budget, and `web_fetch`
  returns a whole page. The SDK also accepts no URL allowlist at session
  creation. Settings now explains this next to the Copilot web-search switch,
  as its own unconditional disclosure rather than something coupled to that
  switch, and points at the canonical `search_web` tool, whose results *are*
  capped, labelled and budgeted.
- **The deny-by-default Copilot permission handler is now installed on every
  session**, subscription and BYOK, instead of only on sessions that configured
  MCP servers. Without a handler the runtime fell back to its own default
  policy, so a run using a network-capable built-in had no shot2code-owned
  answer to "may this URL be fetched?". Any URL the runtime asks to open is
  denied with a reason naming the host and path — never the query string, which
  can carry a token. MCP approvals are unchanged.
- A `ToolSet` that names a blocked built-in — directly or through a
  `builtin:*` wildcard — now fails when the session is built, rather than
  silently granting a capability whose output cannot be bounded.
- **Image results are normalized in one place.** Remote URLs, raw bytes, base64
  and `data:` payloads all pass through one adapter that either keeps a public  URL or writes the image to the served local asset directory, and refuses
  anything unsafe (`file:`, private or loopback addresses that are not our own
  assets, oversized payloads). A locally served image is handed to the model as
  bytes, because such a URL is not fetchable by Anthropic, OpenAI or Gemini.
- Background removal is stated as Replicate-only and behaves that way: the
  `remove_backgrounds` tool is simply not offered without a Replicate key, and
  no other provider's model is substituted. Image editing runs on Replicate, or
  on an OpenAI-compatible endpoint that actually implements `/images/edits` —
  a missing route there is reported as a capability gap, not a credential
  problem.
- Figma MCP is no longer advertised or activated. Figma officially limits both
  its desktop and hosted MCP servers to clients in the Figma MCP Catalog, so
  shot2code filters registry results, disables migrated entries and uses the
  supported scoped-PAT REST workflow instead. Figma 429 responses now preserve
  retry, plan, limit-type and upgrade guidance.

### Fixed

- **Image generation no longer reports success for a batch that produced
  nothing.** Every per-prompt failure used to collapse into `None`, the tool
  still returned success, and the activity feed counted the empty results as
  generated images — three blank grey tiles under "Generated 3 images". Each
  prompt now keeps its own classified outcome (429 rate limit, 402 billing,
  authentication, timeout, or a generic provider error), a batch that produced
  nothing returns a failure with the reason and what to do about it, a partial
  batch truthfully reads "Generated 2 of 5 images", and no success-shaped
  result ever carries an empty URL. The same counting fix applies to
  `remove_backgrounds` and `edit_images`.
- The activity feed replaces the unexplained grey "Failed" tile with an
  accessible alert carrying the classified reason and the action to take, so a
  screen reader announces the failure instead of reading an empty box.
- Image-provider credentials are excluded from commit snapshots, project
  history and streamed tool arguments, mirroring the existing BYOK, MCP and
  web-search secret handling.
- A manually configured Copilot SDK BYOK model is tested directly when an
  OpenAI-compatible gateway does not expose a working optional `/models`
  endpoint. Credential failures still fail immediately, and a connection with
  no configured model still receives an actionable discovery error.
- Non-maximized preview resizing is coalesced through one ResizeObserver and
  one animation-frame write. Unchanged geometry and hidden zero-sized panes no
  longer rewrite iframe dimensions or repeatedly report scale, eliminating the
  resize flicker without rebuilding the preview document.
- The selected preview tab, HTML/Stack source, view mode and zoom now survive
  restart through validated preferences. The desktop also restores validated
  on-screen window bounds/maximized state, while the active project, version
  and file continue to restore from SQLite rather than being duplicated in
  local storage.
- Restoring a saved project no longer reopens on a cancelled option when the
  same generation has a completed option. shot2code selects and persists the
  completed sibling; when every option was cancelled or failed, the sidebar
  now offers Retry instead of incorrectly telling the user to select a
  completed option that does not exist.
- The packaged `file://` renderer now obtains the runtime backend HTTP and
  WebSocket addresses synchronously from the Electron main process instead of
  relying on a mutable environment variable visible to preload. History and
  API calls can no longer fall back to invalid `file:/api/...` URLs.
- The Electron preload no longer imports Node's `crypto` module. Electron 44
  runs the preload in a sandbox where that module is unavailable; the import
  prevented every desktop bridge from loading even though the backend itself
  had started successfully.
- The in-app feedback IPC handler is registered during application startup
  rather than inside the Stitch import callback, so Bug, Feature request and
  Feedback submissions work before any Stitch action has run.

## [0.5.1] - 2026-09-27

The `v0.5.1` source tag was created during release validation but no GitHub
Release was published. Packaged smoke testing then found a cancelled-option
restoration defect and two Electron preload/IPC defects. The draft release was
deleted before it became visible to users, the tag remains immutable, and the
fully corrected build was rolled forward to v0.5.2.

## [0.5.0] - 2026-09-27

Released as [shot2code v0.5.0](https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.5.0).
Checksums for the published Windows artifacts:
[docs/releases/v0.5.0/SHA256SUMS.txt](docs/releases/v0.5.0/SHA256SUMS.txt).

This release turns shot2code into a broader local-first design-to-code
workspace: app-owned GitHub sign-in, multi-model Copilot SDK BYOK, MCP and
Agent Skills discovery, Figma and Stitch imports, durable conversational
history, stronger Review/Design Inspector workflows, exact export-project
inspection, and sandboxed HTML/stack previews.

v0.5.0 was retained as a pre-release and superseded by v0.5.2 after the
optional BYOK model-list probe was found to block a manually configured model.

### Added

- App-owned GitHub OAuth device flow with expiring-token refresh and
  operating-system encrypted storage in the Windows desktop app.
- Official MCP Registry browsing with disabled/untrusted installation drafts,
  plus featured Figma Desktop, Figma Remote and Google Stitch configurations.
- Local/public-GitHub Agent Skill import with validation, provenance, explicit
  enablement and Copilot-only execution; shell tools remain disabled.
- Figma REST/PAT frame import, SVG reference import, and Figma-link generation
  through a configured Copilot MCP runtime.
- Bundled experimental `@google/stitch-sdk` support for prompt generation and
  Stitch project/screen import using the user's API key.
- Design Inspector exports for `DESIGN.md`, `SKILL.md`, and palette PNGs.
- A bounded, no-tools AI-assisted Review pass tied to the exact model recorded
  for the selected option.
- A read-only **Export project** mode in the Code tab that shows the exact
  stack-aware text files and downloaded-asset manifest produced for the project
  ZIP without replacing the current source view.
- An additive **Stack** preview beside the existing HTML preview. Controlled
  Vite HTML, React and Preact export files run inside the existing sandbox
  without executing package scripts or project configuration.
- Desktop packaging now uses Electron 44.4.3, electron-builder 26.15.3 and
  electron-updater 6.8.9; the complete desktop dependency audit is clean.

### Changed

- Chat reconstructs the full active-branch conversation, including persisted
  assistant responses, while History shows each selected option's exact model
  identity.
- One BYOK endpoint can expose several discovered or manually entered models as
  independent selectable identities.
- Upload and Import expose optional first instructions; imported projects can
  immediately enter the same refinement flow.
- Review findings support severity filters, text search, visible-selection
  controls, automatic fixes and model attribution.
- In-app documentation links point to the rendered product site; GitHub remains
  only for source and issue-tracker destinations.
- Project download and pre-download inspection now share one backend projection,
  and the active selected stack is used consistently for both.

### Fixed

- The initial generation WebSocket is accepted before frozen deferred route
  imports finish, and long generations send an application heartbeat.
- An abnormal close after every option reached a terminal state no longer
  reports a false generation failure.
- ScreenshotOne failures now expose actionable authentication, billing,
  rate-limit, timeout and URL messages; the URL tab can test its key.
- Replicate image tools are not advertised without an effective key, while an
  environment-provided key no longer disables the user's image-generation
  preference switch.
- Cancelled selected options automatically fall back to a completed option when
  one exists, keeping Chat editable and Review fixes usable.
- Fragment links inside packaged `srcdoc` previews stay inside the preview
  instead of attempting blocked `file://` navigation.
- Fragment-link interception no longer stops generated pages' own click
  handlers, so `href="#"` controls, menus, tabs and modal triggers remain
  interactive.
- Project data remains outside the installation directory and NSIS explicitly
  preserves app data during upgrades/uninstall-reinstall workflows.
- Stack-preview assets are size-bounded before entering the renderer; assets
  over the preview budget remain visible in the manifest rather than being
  silently dropped.
- Concurrent GitHub device-flow status polls share one serialized backend
  restart, preventing a successful sign-in from entering a kill/restart loop.
- Public GitHub Agent Skills can be imported from a folder directly under the
  repository root as well as from nested folders.
- Frozen first-run Chromium discovery has a larger optional background timeout
  so antivirus scanning does not cache a false unavailable result.

### Security

- Capture-only ScreenshotOne, Figma and Stitch credentials are stripped before
  model-generation payloads are built.
- Imported skills reject traversal, binary/oversized content and duplicate
  installs, remain disabled by default, and cannot introduce shell access.
- Figma image downloads, Stitch SDK downloads and MCP registry entries are
  bounded and restricted to expected HTTPS endpoints.

## [0.4.0] - 2026-09-20

Released as [shot2code v0.4.0](https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.4.0).
Checksums for the published Windows artifacts:
[docs/releases/v0.4.0/SHA256SUMS.txt](docs/releases/v0.4.0/SHA256SUMS.txt).

This release adds a separate GitHub Copilot SDK BYOK runtime, guarded MCP tools,
a multi-viewport Review workspace, a native Windows menu and a provider
reliability pass, without replacing any existing direct provider.

### Added

- **In-app GitHub sign-in.** **Sign in with GitHub** runs the official Copilot
  CLI's own browser flow (`copilot login`), falling back to `gh auth login`.
  shot2code implements no OAuth flow and registers no client id of its own, so
  no token passes through the app; the CLI stores the credential and shot2code
  re-runs its existing credential check afterwards. The command line is fixed,
  the process is launched directly rather than through a shell, its output is
  never shown or logged, and the flow is timed out, cancellable and killed on
  exit. With neither CLI installed it reports that and links to GitHub's install
  instructions.
- **Per-provider connection checks.** Settings can test OpenAI, Anthropic,
  Gemini, Replicate and the BYOK connection individually. Each makes one
  minimal but real request — tiny, though the account may still be billed a
  negligible amount — and reports ready, credentials, billing, quota,
  permissions, model, network or configuration. Replicate uses its account
  endpoint instead of running a prediction.
- **Copilot SDK BYOK.** Configure one dedicated OpenAI-compatible, Azure OpenAI
  or Anthropic connection with its own API key or bearer token, wire API,
  endpoint and optional model-name override. It requires no Copilot
  subscription; an OpenAI-compatible localhost endpoint may be credentialless.
- **BYOK model discovery.** An OpenAI-compatible connection is asked what it
  serves at `/models`, and the bounded result is offered in Settings. The route
  is optional: when an endpoint does not implement it, the model is named by
  hand instead. Azure OpenAI and Anthropic have no equivalent listing and always
  use a manual model name. A listing that fails for a real reason is reported;
  no model list is ever invented.
- **Separate BYOK model identities.** Models appear under **Copilot SDK
  (BYOK)** as `sdk-byok/<provider>/<base model>`, or
  `sdk-byok/<provider>/custom/<model>` for a model only your endpoint knows, so
  a native model and its BYOK twin can run together as distinct variants. The
  identity survives History and retries.
- **MCP servers.** Configure up to eight stdio, HTTP or SSE servers for GitHub
  Copilot subscription and SDK-BYOK variants. Activity is labelled
  `MCP · <server> · <tool>`.
- **Responsive Review.** Compare two to four real viewport widths at once
  (1440px, 768px and 390px by default; custom 320–1920px), with runtime
  horizontal-overflow measurement.
- **Local source audit.** Deterministic semantic and accessibility findings can
  be selected and inserted into Chat without auto-sending, or exported as a
  source-safe JSON report. Results become stale when the version, option, code
  or viewport set changes.
- **Native application menu.** File, Edit, View, Window and Help use the same
  command dispatcher as keyboard shortcuts and keep standard editor roles.

### Changed

- Generation now carries a typed per-selection runtime identity. Native
  OpenAI, Anthropic, Gemini and Copilot choices always remain native even when
  BYOK is enabled.
- A BYOK connection with its own base URL now defaults to **Chat Completions**,
  the interface every standards-compatible endpoint implements; a vendor
  connection with no base URL of its own still defaults to Responses. Either can
  be selected explicitly.
- Naming a model in **Model / deployment** now publishes exactly that one model
  under its real name instead of a whole vendor family, with model names bounded
  to 128 characters.
- Generation failures now report the provider's actual complaint — with an
  action such as "add credits" or "check the API key" — instead of a generic
  "contact support" message. Each option keeps its own error, and a run where
  every option failed reports the real cause.
- Settings reports whether the screenshot-preview browser is available and
  offers **Check again**, and the backend now names the correct recovery
  command (`cd backend && uv run playwright install chromium-headless-shell`).
- The Copilot SDK dependency is locked consistently at 1.0.13.
- In-app Help and the public release-hub guides cover BYOK, MCP permissions,
  Review and native menu behavior.

### Fixed

- Settings now owns a bounded inner scroll area in both empty and active
  projects, so the final provider/tool controls remain reachable instead of
  extending below the fixed desktop shell.
- Disabled or incomplete BYOK settings and disabled/untrusted incomplete MCP
  drafts no longer abort unrelated direct-provider generations.
- An OpenAI account with no remaining credit is now classified as a billing
  problem with an actionable message, rather than surfacing as an unexplained
  API error.
- A custom endpoint model no longer receives a GPT or Claude reasoning-effort
  setting it has no concept of; only the real model name goes on the wire. BYOK
  variants of catalog models still pass the SDK's supported effort values, and
  `no thinking` is omitted because it is not an SDK effort value.
- A client that closes the generation socket before sending its request no
  longer logs an ASGI traceback.

### Security

- BYOK never borrows a direct OpenAI or Anthropic key, and a BYOK base URL must
  be HTTPS unless it points at loopback and may not embed credentials.
- A provider check that names its own OpenAI base URL must supply its own key in
  the same request. The key the backend was configured with is only ever used
  with the backend's own endpoint, so it can never be sent to an address a
  request chooses. Caller-supplied URLs are validated with the same endpoint
  rules as a BYOK connection.
- Starting or cancelling the in-app GitHub sign-in is accepted only from
  shot2code's own local window (a `localhost`/`127.0.0.1`/`::1` origin, or the
  packaged app's `null` origin), so a web page cannot trigger a sign-in or kill
  one. Reading sign-in status stays read-only and unguarded.
- MCP servers require both **Enabled** and **Trusted**. They remain read-only
  unless **Allow write tools** is enabled.
- Stdio MCP commands use an explicit argument vector rather than a shell;
  remote MCP requires HTTPS except on localhost.
- Integration secrets are masked and excluded from validation responses,
  activity logs, project history and exported Review reports. Provider errors
  are redacted before they are shown or logged, including a credential quoted
  back by the provider.

### Accessibility

- Review frames use real labeled viewport widths and keyboard-operable controls.
- Findings expose severity, evidence and guidance; the UI states clearly that
  the deterministic source audit is not WCAG certification.
- Native menu actions share the renderer's guarded commands so editor-specific
  shortcuts and focus behavior remain intact.

## [0.3.3] - 2026-09-14

Released as [shot2code v0.3.3](https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.3.3).
Checksums for the published Windows artifacts:
[docs/releases/v0.3.3/SHA256SUMS.txt](docs/releases/v0.3.3/SHA256SUMS.txt).

This release makes the desktop workspace adjustable instead of forcing one
fixed split, adds an in-app Help centre backed by the public app-releases
guides, and makes desktop zoom reliable on Windows keyboards.

### Fixed

- **Packaged startup no longer waits for optional features.** Frozen startup
  previously imported generation, evaluation and project-tool dependencies
  before health could answer, then synchronously launched Playwright. On slow
  runs this delayed readiness for 299–347 seconds and exceeded the shell
  timeout. Core routes now start first, heavy routers load on first use, and
  Chromium/Copilot discovery runs as bounded background work.
- **Backend readiness is verified precisely.** Electron requires HTTP 200 with
  a real `{"ok": true}` response, fails immediately if the backend exits or
  cannot spawn, logs the readiness duration, and uses a 90-second cold-start
  deadline instead of waiting on optional capabilities.
- **Optional failures remain explicit.** Deferred route import failures return
  an error and subsequently make health fail rather than pretending the
  backend is healthy. Chromium is only advertised after it launches
  successfully and is closed during backend shutdown.

### Added

- **Resizable Chat and History panel.** At desktop widths, drag the separator
  between the conversation/History panel and Preview or Code. The separator is
  keyboard-operable with arrow keys, larger Shift+arrow steps, Home/End bounds,
  Enter or double-click reset, and Escape to cancel an active drag.
- **Resizable project file explorer.** Multi-file Code workspaces have an
  independent drag/keyboard separator with sensible editor and explorer
  minimums. Single-file projects still avoid wasting space on an empty tree.
- **Persisted UI-only pane preferences.** Chat and explorer widths survive
  restarts and collapse/reopen cycles, but remain separate from project
  commits, variants, retries and History. Changing a pane cannot change or
  create a project version.
- **In-app Help centre.** The rail's Help action and **Ctrl+/** open Get started,
  Guides, Support and Keyboard shortcuts. Links open the authoritative
  app-releases product page, complete release history, install/user/FAQ/
  troubleshooting/architecture/data/security/changelog/contributing/
  third-party/releasing guides, issues and source repository.
- **Open diagnostic logs.** Packaged desktop users can open the backend log
  folder directly from Help, with explicit success and failure feedback. The
  browser development build explains why that action is unavailable.
- **Explicit desktop zoom controls.** `Ctrl+=` and `Ctrl++` zoom in,
  `Ctrl+-` zooms out, numpad Add/Subtract work, and `Ctrl+0` resets. Zoom moves
  in deterministic 10-point steps and is bounded from 50% to 300%.

### Changed

- Pane widths clamp to the current viewport so neither Chat nor the main
  workspace becomes unusable. Below the desktop split breakpoint, the existing
  Preview/Chat/History destinations remain unchanged and no drag handle is
  shown.
- Chat spacing and composer controls reflow at the minimum supported panel
  width without hiding Send, model selection or design-system controls.
- The former Shortcuts-only dialog is now the broader Help centre; the full
  shortcut reference remains available inside it.

### Accessibility

- Pane handles use `role="separator"`, vertical orientation, current/min/max
  values, value text, controlled-pane relationships, keyboard instructions,
  visible focus and a 44-pixel interaction gutter.
- Help retains focus trapping, descriptive external-link labels, 44-pixel
  tabs/rows, mobile horizontal tab scrolling and honest disabled states.
- Recognized zoom keys suppress Chromium's duplicate handling without
  consuming unrelated editor input, AltGr or composition events.

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

[Unreleased]: https://github.com/ArasaniRohithReddy/shot2code/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/ArasaniRohithReddy/shot2code/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/ArasaniRohithReddy/shot2code/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/ArasaniRohithReddy/shot2code/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ArasaniRohithReddy/shot2code/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ArasaniRohithReddy/shot2code/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/ArasaniRohithReddy/shot2code/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/ArasaniRohithReddy/shot2code/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.3.1
[0.3.0]: https://github.com/ArasaniRohithReddy/shot2code/releases/tag/v0.3.0
