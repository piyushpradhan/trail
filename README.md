# Trail

Menubar task tracker that watches everywhere you start work — GitHub PRs and issues, AI coding sessions (Claude Code, Codex, OpenCode), terminal shells, tmux — and keeps you honest about what you've actually finished.

The problem this solves: you start three tasks before lunch, pick up two more after, and at 5pm you've forgotten about the PR you said you'd test "just in case it breaks." Trail keeps a running ledger of everything you started, what state it's in, and which ones have gone stale.

> **Status:** early. Personal project. APIs and storage may change.

## Features

- **Tray-only Linear-style UI** — popover toggled by `Ctrl+Shift+Space` (or click the tray icon).
- **GitHub lifecycle tracking** — PRs auto-flip status: open → in_review, changes_requested → blocked, merged → done. Issues assigned to you become tasks.
- **AI session collectors** — extracts candidate tasks from Claude Code (`~/.claude/projects/*.jsonl`), OpenAI Codex, OpenCode session logs.
- **Terminal session detection** — tails PowerShell PSReadLine, bash/zsh/fish history, WSL distros. Optional shell hook (PowerShell + bash) that pings a local HTTP endpoint at session start so opening a new shell auto-creates a task tagged with repo + branch.
- **LLM reconciler** — Haiku 4.5 second-pass over rejected prompts to dedupe and merge into existing tasks. Prompt caching enabled. Cost ~$0.005/run.
- **Stalled-task detector** — tray badge + EOD nudge when something's been untouched for 6h+.
- **Command palette** — `Cmd/Ctrl+K`, fuzzy search, run any collector, jump to task, cycle status.

## Stack

Electron 32 · TypeScript · React 18 · Vite · sql.js (pure-WASM SQLite, zero native build) · Anthropic SDK · electron-store with safeStorage encryption.

## Develop

```bash
npm install
npm run dev          # launches Electron with hot reload
npm test             # 130 tests, ~1s
npm run typecheck
npm run package      # builds NSIS installer (Windows) / dmg (macOS)
```

## Configure

Open Settings (gear icon in popover header):

1. **GitHub** — paste a PAT (`repo` + `read:user` scopes) or rely on `gh auth login`. Optional include/exclude repo filters.
2. **Anthropic API key** — required only for the LLM reconciler. Stored encrypted via OS keychain.
3. **Shell hook** — copy the displayed path into your `$PROFILE` (PowerShell) or `~/.bashrc` (bash/zsh) to track new shell sessions.

## Architecture

```
src/
  main/                     # Electron main process
    db.ts                   # sql.js + repos (tasks, events)
    settings.ts             # encrypted config (API keys, GitHub PAT)
    reconciler.ts           # LLM dedup pass over events
    hookServer.ts           # 127.0.0.1:47123 shell-hook endpoint
    nudge.ts                # EOD + morning notifications
    tray.ts                 # menu bar icon
    collectors/             # github, claude, codex, opencode, terminal, tmux
  preload/                  # context bridge
  renderer/                 # React UI (Linear-style)
  shared/                   # shared TS types
tests/                      # vitest (unit, no UI)
resources/hooks/            # trail-hook.ps1, trail-hook.sh
```

## Cross-platform

| Platform | Status |
|---|---|
| Windows | tested (primary dev target) |
| macOS | should work — vibrancy + dock-hide implemented |
| Linux | should work — paths covered, untested |

## License

MIT
