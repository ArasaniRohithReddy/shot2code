# Support

shot2code is maintained by one person in their spare time. Help is best-effort,
but the more precise your report is, the faster it gets fixed.

**Start here:** most problems already have an answer in
**[Troubleshooting.md](Troubleshooting.md)** — install warnings, blank windows,
"backend did not become ready", Copilot sign-in, provider connection checks,
missing models, BYOK endpoints and model lists, imports that find nothing, and
the extra keys some features need.

## Where to go

| You want to… | Go to |
|---|---|
| Fix an install, startup or sign-in problem | [Troubleshooting.md](Troubleshooting.md) |
| Understand a feature or an export strategy | [README.md](README.md) |
| Run it from source, or run the tests | [CONTRIBUTING.md](CONTRIBUTING.md) and [TESTING.md](TESTING.md) |
| See what changed in a release | [CHANGELOG.md](CHANGELOG.md) and [Releases](https://github.com/ArasaniRohithReddy/shot2code/releases) |
| Verify a download | [docs/releases/](docs/releases/) |
| Report a bug | [New bug report](https://github.com/ArasaniRohithReddy/shot2code/issues/new?template=bug_report.md) |
| Request a feature | [New feature request](https://github.com/ArasaniRohithReddy/shot2code/issues/new?template=feature_request.md) |
| Ask a question | [Search existing issues](https://github.com/ArasaniRohithReddy/shot2code/issues?q=is%3Aissue) first, then open one |
| Report a security vulnerability | **[SECURITY.md](SECURITY.md)** — do not open a public issue |

GitHub Discussions is **not enabled** on this repository, so questions go in
[Issues](https://github.com/ArasaniRohithReddy/shot2code/issues) too. Please
search first — the answer is often already there.

## Before you open an issue

1. Read [Troubleshooting.md](Troubleshooting.md).
2. Confirm you are on the
   [latest release](https://github.com/ArasaniRohithReddy/shot2code/releases/latest);
   several known problems (partial auto-updates, the update wizard waiting for a
   click) are fixed in later builds.
3. [Search open and closed issues](https://github.com/ArasaniRohithReddy/shot2code/issues?q=is%3Aissue)
   for the same symptom.

## Reporting a bug

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- What happened, what you expected, and numbered steps to reproduce
- The version from **Settings**, or the installer filename
- How you run it: NSIS installer, MSI, portable ZIP, or from source
- Which model provider and model you used, including whether the option was a
  native model or an `sdk-byok/...` identity
- For a provider or sign-in problem, the **category** the Settings connection
  check reported (`credentials`, `billing`, `quota`, `permissions`, `model`,
  `network`, `configuration`) and its message — it is written to be safe to
  paste, but check it for anything private first
- Whether an MCP server or the Review workspace was involved
- For the desktop app, the **tail of the log** — this is usually enough on its own:

  ```
  %APPDATA%\shot2code-desktop\shot2code-backend.log
  ```

  It records backend startup, renderer load failures, crashes and console errors.
- A screenshot, if the problem is visual

**Redact API keys, GitHub tokens and anything private** from logs and
screenshots before posting.

For generation problems, also say which output stack you selected, how many
screenshots you uploaded, and — with more than one — which multi-screenshot mode
you chose (separate pages, responsive views, UI states, supporting references).

## Requesting a feature

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).
Describe the problem you are trying to solve before the solution you have in
mind, say where in shot2code it would live (upload, generation, editor,
preview, Review, export, import, history, settings, MCP, desktop shell), and mention any
workaround you use today.

Requests that would require executing imported project code, or that would make
previews less isolated, are unlikely to be accepted — see the reasoning in
[SECURITY.md](SECURITY.md).

## Security issues

Do **not** open a public issue. Report privately through
[GitHub Security Advisories](https://github.com/ArasaniRohithReddy/shot2code/security/advisories/new).
Full details are in [SECURITY.md](SECURITY.md).

## What is not supported

- Older releases: fixes ship in the newest release rather than as patches to
  older installers.
- Provider-side problems (an expired Copilot subscription, provider outages,
  rate limits, billing) — those belong with the provider.
- The quality of a specific generation. Models vary; try another model, another
  stack, or a clearer screenshot. Open an issue only if something is
  reproducibly and structurally wrong, such as a mode that ignores a screenshot
  or an export that will not build.
