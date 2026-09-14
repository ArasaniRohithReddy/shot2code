# Security Policy

shot2code runs on your own machine. Screenshots, generated code, project history
and API keys stay local; the only outbound traffic is to the model provider you
configure, plus the update check and anything you explicitly share.

## Supported versions

Only the most recent release line receives security fixes. Fixes ship as a new
release rather than as patches to older installers.

| Version | Supported |
|---|---|
| 0.3.3 | ✅ Yes — current release |
| 0.3.2 | ⚠️ Supported for security fixes; update for workspace and zoom improvements |
| 0.3.1 | ⚠️ Superseded by the installer-hardening release; update when you can |
| 0.3.0 | ❌ No — its updater could replace a live backend; upgrade immediately |
| < 0.3 | ❌ No — upgrade to the [latest release](https://github.com/ArasaniRohithReddy/shot2code/releases/latest) |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub Security Advisories:

1. Go to <https://github.com/ArasaniRohithReddy/shot2code/security/advisories/new>
   (or the **Security** tab → **Report a vulnerability**).
2. Describe the issue, the affected version, and the impact.
3. Include reproduction steps, and a proof of concept if you have one.

Private vulnerability reporting is enabled on this repository, so the report is
visible only to you and the maintainer until an advisory is published.

Useful details to include:

- shot2code version (Settings, or the installer filename)
- How you run it: NSIS installer, MSI, portable ZIP, or from source
- Which model provider was configured
- Relevant log lines from `%APPDATA%\shot2code-desktop\shot2code-backend.log`,
  **with any API keys or tokens redacted**

This is a small, best-effort project maintained by one person. Expect an
acknowledgement when the report is read, and a fix timeline that depends on
severity. Please give a reasonable window for a fix before disclosing publicly.
Credit is given in the advisory unless you prefer otherwise.

## API keys and local data

- Provider API keys entered in **Settings** are stored by the frontend on your
  device only. They are sent to the backend with a generation request and used to
  call that provider — they are not stored server-side and are not sent anywhere
  else.
- `REPLICATE_API_KEY` has no Settings field. It must be set in `backend/.env` and
  is used only for the image generation, editing and background-removal tools.
- GitHub Copilot credentials are resolved at request time (a token in Settings,
  then `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`, then a stored
  `copilot` login, then `gh auth login`). Tokens are not persisted or logged; the
  model cache is keyed by a SHA-256 fingerprint of the credential.
- Project history lives in a local SQLite database, `history.sqlite3`, under your
  user data directory (`%LOCALAPPDATA%\shot2code\` on Windows). It is not
  encrypted — treat it like any other local project folder, and delete projects
  from **Recent projects** when you no longer want them on disk.
- `backend/.env` is git-ignored. Never commit keys, tokens, or a copy of
  `history.sqlite3`, and redact keys from logs and screenshots before attaching
  them to an issue.
- shot2code contains no analytics or telemetry SDK; nothing about your usage is
  collected.

## Unsigned Windows binaries and SmartScreen

The Windows builds are **not code-signed**. Windows will show
*"Windows protected your PC"* (SmartScreen) the first time you run an installer,
and downloaded files carry the mark of the web. That warning is expected; it is
not evidence that the download is good or bad.

Because there is no signature to check, verify the download yourself:

1. Download only from
   [GitHub Releases](https://github.com/ArasaniRohithReddy/shot2code/releases) for
   this repository.
2. Compare the SHA-256 hash with the checksums published in
   [`docs/releases/`](docs/releases/) — for example
   [v0.3.3](docs/releases/v0.3.3/SHA256SUMS.txt):

   ```powershell
   Get-FileHash .\shot2code-0.3.3-x64.exe -Algorithm SHA256
   ```

3. Only then click **More info → Run anyway**, or right-click the file →
   **Properties** → **Unblock** → **Apply**.

If a hash does not match, stop and report it.

## Update integrity

- Per-user NSIS installs update through `electron-updater` against the public
  GitHub Releases feed. The `latest.yml` manifest published with each release
  carries the SHA-512 of the installer, and the updater refuses a download whose
  hash does not match the manifest.
- Updates are fetched over HTTPS from `github.com`. The `.exe.blockmap` published
  next to the installer is what allows a differential download; without it the
  updater falls back to the full installer.
- Before installing, shot2code stops the bundled backend process tree
  synchronously, so an update cannot replace a running PyInstaller tree and leave
  a half-installed app behind.
- MSI installs are per-machine managed deployments. The app detects a Program
  Files install, disables self-update, and leaves upgrades to the administrator.
- `latest.yml` must always describe the binaries actually attached to the same
  release. Releases are therefore published from a locally verified build rather
  than from CI — see [docs/RELEASING.md](docs/RELEASING.md).

## Imported and generated code

shot2code treats every project you import and every page it generates as
untrusted input.

- **Imported projects are never executed.** The scanner parses text only; it does
  not `require()`/import `tailwind.config.*` or any other configuration or
  application module, and it does not run install or build commands.
- The scanner rejects path traversal, ignores dependency and build-output
  directories, and enforces limits on archive size, entry count, file count,
  per-file size and total decoded text.
- Raw imported source is not written into persisted project context. Only the
  compact summary is stored; the normalized file payload exists for the active
  editable-import handoff.
- **Previews are sandboxed.** Generated documents render from `srcDoc` in an
  iframe without `allow-same-origin`, so they run in an opaque origin and cannot
  read app state, cookies or storage. A restrictive Content-Security-Policy, a
  `no-referrer` policy, and a permissions list denying camera, microphone,
  geolocation and display capture are applied on top.
- Select-and-edit uses a per-preview message bridge: messages are accepted only
  when the channel and a random per-preview nonce match, and payloads are
  size-capped.
- Generated code is still model output. **Review it before you run it outside the
  preview**, especially anything that touches the network, the filesystem, or
  credentials.
- Sharing to CodePen sends code off your device to a third party. It is never
  automatic and always asks for confirmation first.

## Out of scope

- Missing Authenticode signatures / SmartScreen warnings on the published
  binaries — known and documented above.
- Vulnerabilities in third-party model providers, CodePen, or CDN-hosted
  framework assets loaded by a preview.
- Findings that require an attacker who already has local access to your user
  account or can modify the installation directory.
- Insecure code produced by a model in response to a prompt. Report a
  *systemic* prompt-injection or sandbox-escape path instead.
