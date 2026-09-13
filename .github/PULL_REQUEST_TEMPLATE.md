<!--
Thanks for contributing! Please read CONTRIBUTING.md if you haven't yet.
Keep the PR focused on one change — small diffs get reviewed faster.
-->

## What this changes

<!-- One or two sentences. What problem does this solve? -->

Closes #

## Why

<!-- Context, or the reasoning behind the approach. Link the issue or discussion
     that prompted it. If you considered another approach and rejected it, say so. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / internal cleanup
- [ ] Documentation
- [ ] Build, packaging or tooling

## Areas touched

- [ ] Backend (`backend/`)
- [ ] Frontend (`frontend/`)
- [ ] Desktop shell / packaging (`desktop/`)
- [ ] Prompts (`backend/prompts/`)
- [ ] Export / CodePen
- [ ] Project import
- [ ] History / SQLite schema
- [ ] Docs only

## How it was tested

<!-- Paste the commands you ran and the outcome. Say plainly if you could not
     run something (no Copilot subscription, no Windows machine, etc.). -->

- [ ] `cd backend && uv run pytest`
- [ ] `cd backend && uv run pyright` (no new warnings in changed files)
- [ ] `cd frontend && pnpm test`
- [ ] `cd frontend && pnpm exec tsc --noEmit`
- [ ] `cd frontend && pnpm lint` (no *new* errors — baseline errors exist)
- [ ] `cd frontend && pnpm build`
- [ ] `cd desktop && node --check main.js && node --check preload.js`
- [ ] Export changes: `cd backend && uv run python scripts/validate_export_projects.py`
- [ ] Verified in a **packaged** desktop build (required for routing, asset
      paths, `location.origin`, `window.open`, `getDisplayMedia`, or backend-URL
      changes — see AGENTS.md)

```
paste the relevant command output here
```

## Screenshots / recordings

<!-- For UI changes. Delete this section if it doesn't apply. -->

## Checklist

- [ ] The change is scoped to one thing
- [ ] Tests added or updated for the behaviour change (a bug fix has a test that
      fails without it)
- [ ] Docs updated where this invalidates them (`README.md`, `TESTING.md`,
      `Troubleshooting.md`, `AGENTS.md`, `design-docs/`)
- [ ] A bullet added under `## [Unreleased]` in `CHANGELOG.md` if users would
      notice this
- [ ] **No secrets**: no API keys, tokens, `.env` files, or `history.sqlite3`;
      logs and screenshots redacted
- [ ] No version bumps (`desktop/package.json` is bumped only at release time —
      see `docs/RELEASING.md`)
- [ ] No build artefacts committed (`desktop/renderer`, `desktop/backend-dist`,
      `desktop/dist`, `backend/dist-pyinstaller`, `node_modules`, `.venv`)
- [ ] Imported project code is still never executed, and previews are still
      sandboxed (see `SECURITY.md`)
