# CLAUDE.md

This file exists so Claude Code picks up the same instructions as every other
agent working in this repository.

- **[AGENTS.md](AGENTS.md)** — the authoritative conventions and gotchas:
  Python/uv setup, the testing and type-checking policy, prompt formatting,
  model providers, the imported-project rules, and the desktop `file://`
  and packaging traps. Read it first.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — setup, the exact test/lint/build
  commands, pull request conventions, and the "no secrets" rules.
- **[TESTING.md](TESTING.md)** — the full list of test commands.
- **[SECURITY.md](SECURITY.md)** — the untrusted-input model for imported and
  generated code.
- **[docs/RELEASING.md](docs/RELEASING.md)** — `desktop/package.json` is the
  release version; never bump versions in an ordinary change.

There are no Claude-specific instructions beyond those documents. Keep guidance
in AGENTS.md so every agent and every human sees the same thing.
