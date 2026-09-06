---
name: Bug report
about: Something isn't working
title: ''
labels: bug
assignees: ''

---

**What happened**

**What you expected instead**

**Steps to reproduce**
1.
2.

**How are you running shot2code?**
- [ ] Desktop app (installer)
- [ ] Desktop app (portable zip)
- [ ] From source (`pnpm dev` + `uv run uvicorn`)

Version (Settings, or the installer filename):

**Which model provider?**
- [ ] GitHub Copilot
- [ ] OpenAI
- [ ] Anthropic
- [ ] Gemini

**Logs**

For the desktop app, attach the tail of:

```
%APPDATA%\shot2code-desktop\shot2code-backend.log
```

It records backend startup, renderer load failures, crashes and console errors,
and is usually enough to identify the cause. Redact any API keys before posting.

**Screenshots**
If the problem is visual, a screenshot helps a lot.
