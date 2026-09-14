# Releasing shot2code

Releases are cut **from a locally verified Windows build**, not from CI. The
tag-triggered workflow (`.github/workflows/release.yml`) only proves that the
desktop app still packages — it runs `electron-builder … --publish never` on
purpose. CI publishing skips re-uploading an asset that already exists but still
replaces `latest.yml`, which once left a release whose manifest described a
binary that was no longer attached and broke auto-update.

## The version source of truth

**`desktop/package.json` → `version` is the released product version.** It is
what electron-builder stamps into `shot2code-<version>-x64.exe`, what
`latest.yml` advertises, what Settings displays, and what the updater compares.

The other `version` fields are **internal workspace metadata and are
deliberately not kept in sync**:

| File | Field | Meaning |
|---|---|---|
| `desktop/package.json` | `0.3.3` | **The release version.** Bump this. |
| `package.json` (root) | `0.1.0` | Private workspace root; never shipped |
| `frontend/package.json` | `0.0.0` | Private Vite app; never published to npm |
| `backend/pyproject.toml` | `0.1.0` | Private package; frozen by PyInstaller |

Do not "fix" the others to match. Changing them implies a versioning contract
that does not exist, and `frontend`/`backend` are `private` packages that are
never published.

The git tag (`v0.3.3`) and the GitHub release name mirror
`desktop/package.json`. Never reuse or move a tag that has been published.

## 1. Pre-flight

From a clean tree on `main`, with no uncommitted changes:

```powershell
cd backend
uv sync
uv run pytest
uv run pyright

cd ..\frontend
pnpm install
pnpm test
pnpm exec tsc --noEmit
pnpm lint            # pre-existing baseline errors are expected
pnpm build

cd ..\desktop
node --check main.js
node --check preload.js
node --test update-lifecycle.test.js
```

If export or import changed, also run the full export validator (it really runs
`npm install` and `npm run build` for every stack):

```powershell
cd backend
uv run python scripts/validate_export_projects.py
```

## 2. Bump the version and the changelog

1. Edit `desktop/package.json` **as text** and set `version`.
   **Never round-trip it through `ConvertFrom-Json` / `ConvertTo-Json`** — that
   drops fields.
2. Move the `## [Unreleased]` entries in [`CHANGELOG.md`](../CHANGELOG.md) into a
   new `## [x.y.z] - YYYY-MM-DD` section, and update the link definitions at the
   bottom.
3. Commit (for example `chore(release): 0.3.3`) and push `main`.

## 3. Build the artifacts

Windows 10/11 x64, PowerShell, from the repository root:

```powershell
# Renderer
cd frontend
pnpm install --frozen-lockfile
pnpm build
cd ..

# Backend, frozen with PyInstaller
cd backend
uv sync --frozen
uv run pyinstaller shot2code-backend.spec --noconfirm --distpath dist-pyinstaller

# Headless Chromium only: full Chromium adds ~427MB and is never used
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\dist-pyinstaller\shot2code-backend\ms-playwright"
uv run playwright install chromium-headless-shell
Remove-Item Env:\PLAYWRIGHT_BROWSERS_PATH
cd ..

# Stage payloads for electron-builder
Remove-Item -Recurse -Force desktop\renderer, desktop\backend-dist -ErrorAction SilentlyContinue
Copy-Item -Recurse frontend\dist desktop\renderer
Copy-Item -Recurse backend\dist-pyinstaller\shot2code-backend desktop\backend-dist

# Installers
cd desktop
npm install
npx electron-builder --win nsis msi zip --publish never
```

## 4. Validate the build output

`desktop/dist` must contain **all five** required files:

| File | Why it is required |
|---|---|
| `shot2code-<version>-x64.exe` | NSIS per-user installer; the recommended download and the only self-updating format |
| `shot2code-<version>-x64.exe.blockmap` | Differential download map. Without it the updater falls back to downloading the whole installer |
| `latest.yml` | The `electron-updater` manifest: version, filename, size and SHA-512 |
| `shot2code-<version>-x64.msi` | Per-machine managed deployment; administrator-controlled upgrades |
| `shot2code-<version>-x64.zip` | Portable build |

Check them, and confirm `latest.yml` describes the binary you just built:

```powershell
cd desktop\dist
Get-ChildItem shot2code-*-x64.*, latest.yml | Select-Object Name, Length
Get-Content latest.yml

# The sha512 in latest.yml is base64, not hex
$exe = "shot2code-<version>-x64.exe"
[Convert]::ToBase64String(
  [System.Security.Cryptography.SHA512]::Create().ComputeHash(
    [System.IO.File]::ReadAllBytes((Resolve-Path $exe))))
```

`version`, `path`, `files[0].url`, `size` and `sha512` in `latest.yml` must match
the `.exe` byte for byte. If they do not, rebuild — do not hand-edit
`latest.yml`.

Record the SHA-256 checksums for publication:

```powershell
Get-ChildItem shot2code-*-x64.exe, shot2code-*-x64.exe.blockmap, `
              shot2code-*-x64.msi, shot2code-*-x64.zip, latest.yml |
  Get-FileHash -Algorithm SHA256 |
  ForEach-Object { "{0}  {1}" -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) }
```

## 5. Smoke-check before publishing

Do these against the built artifacts, not a dev server:

- Install with the NSIS `.exe`. The first launch takes about a minute while the
  frozen backend starts; the splash stays up until `/api/health` answers.
- The window renders (it is served over `file://` — a blank window means the
  router or an asset path regressed). If it is blank, read
  `%APPDATA%\shot2code-desktop\shot2code-backend.log`.
- Settings shows the new version, and the provider status you expect.
- Generate once from a screenshot, open the Code tab, and download a project
  folder.
- Run the portable `.zip` from a different directory.
- Install the `.msi` and confirm Settings reports that updates are
  administrator-managed.
- Uninstall cleanly.

## 6. Tag, publish, upload

```powershell
git tag -a v<version> -m "shot2code v<version>"
git push origin v<version>
```

Pushing the tag starts the build-only workflow. It never publishes; let it prove
the packaging still works.

Then create the release and attach **all five** artifacts:

```powershell
cd desktop\dist
gh release create v<version> `
  "shot2code-<version>-x64.exe" `
  "shot2code-<version>-x64.exe.blockmap" `
  "shot2code-<version>-x64.msi" `
  "shot2code-<version>-x64.zip" `
  "latest.yml" `
  --title "shot2code v<version>" `
  --notes-file ..\..\CHANGELOG.md
```

Upload order matters if you attach assets in separate steps: **upload the
binaries first and `latest.yml` last.** A manifest that is live before its
installer points every updating client at a file that does not exist yet.

Publishing as a draft first and flipping it to published once all five assets
are attached is the safest variant — the updater feed only sees published
releases.

## 7. After publishing

1. Confirm the asset list:

   ```powershell
   gh release view v<version> --json assets --jq '.assets[] | "\(.name)  \(.size)"'
   ```

2. Re-download and verify the checksums you recorded in step 4:

   ```powershell
   curl.exe -sL -o latest.yml "https://github.com/ArasaniRohithReddy/shot2code/releases/download/v<version>/latest.yml"
   Get-FileHash .\latest.yml -Algorithm SHA256
   ```

3. Commit the checksums to `docs/releases/v<version>/SHA256SUMS.txt` (see
   [v0.3.3](releases/v0.3.3/SHA256SUMS.txt) for the format) and link them from
   the README download table.
4. Verify the update path from the previous version: install the previous NSIS
   build, let it check for updates, and confirm it downloads, installs silently
   and relaunches on the new version.

## Updater behaviour to keep in mind

- Only the **per-user NSIS** install self-updates. `electron-updater` reads
  `latest.yml` from the latest published GitHub release, verifies the SHA-512,
  downloads automatically, and installs on demand or at quit.
- Installs are **silent** (`quitAndInstall(true, true)`) and relaunch. The
  default opens the full NSIS wizard and waits for a click.
- The bundled backend process tree (Python, Copilot CLI, Chromium) is killed
  **synchronously** before the installer runs. An asynchronous kill let NSIS
  replace a live PyInstaller tree and produced installs missing native `.pyd`
  modules.
- Installs under Program Files (the MSI layout) are treated as managed: the app
  disables self-update and tells the user upgrades are administrator-controlled.
- The builds are unsigned, so SmartScreen warns on first run. That is documented
  in [SECURITY.md](../SECURITY.md) and
  [Troubleshooting.md](../Troubleshooting.md); publish the checksums so people
  can verify the download themselves.

## Rollback

A published release cannot be edited safely in place, and **tags are never moved
or reused**. Pick the least destructive option that fixes the problem:

- **`latest.yml` is wrong or missing an asset** — re-upload the correct
  `latest.yml` from the same verified build immediately
  (`gh release upload v<version> latest.yml --clobber`). This is the one asset
  worth replacing quickly, because it is what clients poll.
- **The release is broken for everyone** — mark it as a pre-release or delete the
  release (`gh release edit v<version> --prerelease`, or
  `gh release delete v<version>`). The updater feed then falls back to the
  previous published release, and users stop being offered the bad build. Keep
  the tag; deleting it does not un-ship anything and breaks the commit ↔ release
  link.
- **Users are already on the bad build** — the only real fix is to roll forward:
  bump `desktop/package.json` to the next patch, rebuild, and publish. The
  updater does not downgrade, and a *lower* version in `latest.yml` will not be
  installed.
- Never delete or replace an installer that clients may already be downloading
  while its manifest is still live. Remove the manifest first, then the binary.
- If a leaked credential or a security issue is involved, follow
  [SECURITY.md](../SECURITY.md) as well: revoke first, then unpublish.
