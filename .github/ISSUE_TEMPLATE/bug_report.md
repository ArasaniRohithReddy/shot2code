---
name: Bug report
about: Something isn't working
title: ''
labels: bug
assignees: ''

---

<!-- Please check Troubleshooting.md first: most install, startup, sign-in and
     import problems are answered there. Then search existing issues. -->

**What happened**

**What you expected instead**

**Steps to reproduce**
1.
2.

**How are you running shot2code?**
- [ ] Desktop app — NSIS installer (`shot2code-<version>-x64.exe`)
- [ ] Desktop app — MSI (`shot2code-<version>-x64.msi`, per-machine/managed)
- [ ] Desktop app — portable zip (`shot2code-<version>-x64.zip`)
- [ ] From source (`pnpm dev` + `uv run uvicorn`)
- [ ] Backend in Docker (`docker-compose up`)

Version (Settings, or the installer filename):

Windows version (e.g. Windows 11 23H2, x64):

**Which model provider?**
- [ ] GitHub Copilot (via `gh auth login` / `copilot` login)
- [ ] GitHub Copilot (token pasted into Settings)
- [ ] GitHub Copilot SDK BYOK (`sdk-byok/...`)
- [ ] OpenAI
- [ ] Anthropic
- [ ] Gemini
- [ ] Replicate (image generation/editing — `REPLICATE_API_KEY` in `backend/.env`)
- [ ] Not sure / not reached that point

Model(s) selected:

**Where does it go wrong?**
- [ ] Upload / screen recording
- [ ] Generation (streaming, variants, retry)
- [ ] Preview (sandboxed preview, select-and-edit)
- [ ] Review (responsive frames, overflow or source audit)
- [ ] Code tab / file tree / editing
- [ ] Export (single HTML or project folder) or CodePen
- [ ] Import an existing project (folder, ZIP, source files)
- [ ] Project history / recent projects
- [ ] Settings, install, startup or auto-update
- [ ] MCP server configuration or tool execution

BYOK provider/endpoint type, if used:

MCP transport and server name, if used (do not paste credentials):

**Generation details** (if the problem is with the generated result)

- Output stack (e.g. `html_tailwind`, `react_tailwind`):
- Number of screenshots:
- Multi-screenshot mode, if more than one: separate pages / responsive views /
  UI states / supporting references

**Logs**

For the desktop app, attach the tail of:

```
%APPDATA%\shot2code-desktop\shot2code-backend.log
```

It records backend startup, renderer load failures, crashes and console errors,
and is usually enough to identify the cause. Redact any API keys before posting.

**Screenshots**
If the problem is visual, a screenshot helps a lot.
