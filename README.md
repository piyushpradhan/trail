# Trail

[![CI](https://github.com/piyushpradhan/trail/actions/workflows/ci.yml/badge.svg)](https://github.com/piyushpradhan/trail/actions/workflows/ci.yml)
[![Release](https://github.com/piyushpradhan/trail/actions/workflows/release.yml/badge.svg)](https://github.com/piyushpradhan/trail/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A menubar task tracker that watches everywhere you start work — GitHub PRs and issues, Linear tasks, Slack DMs, AI coding sessions (Claude Code, Codex, OpenCode), terminal shells, tmux — and keeps you honest about what you've actually finished.

**The problem this solves:** you start three tasks before lunch, pick up two more after, and at 5pm you've forgotten about the PR you said you'd test "just in case it breaks." Trail keeps a running ledger of everything you started, what state it's in, and which ones have gone stale.

## Install

Grab the latest binary for your platform from the [releases page](https://github.com/piyushpradhan/trail/releases/latest):

- **Windows** — `trail-windows-x64-setup.exe` (NSIS installer, unsigned — SmartScreen will warn on first run)
- **macOS** — `trail-macos-arm64.dmg` (Apple Silicon) or `trail-macos-x64.dmg` (Intel) — unsigned, right-click → Open
- **Linux** — `trail-linux-x86_64.AppImage` — `chmod +x` and run

Auto-update kicks in 30s after launch and every 4h thereafter, so future versions install themselves.

## Features

### Sources
| Source | What it tracks | How it stays current |
|---|---|---|
| **GitHub** | PRs you authored, PRs requesting your review, assigned issues | API (PAT) or `gh` CLI; status auto-flips on merge / changes-requested / close |
| **Linear** | Issues assigned to you, recently completed | GraphQL API; state.type maps to task status |
| **Slack** | DMs from other users, @-mentions in channels | xoxp user OAuth; per-channel cursor on `oldest` |
| **Claude Code** | User prompts from `~/.claude/projects/*.jsonl` | `fs.watch` recursive, 2s debounce |
| **Codex** | User prompts from `~/.codex/sessions` | `fs.watch` recursive |
| **OpenCode** | User messages from `storage/message/*` + parts | `fs.watch` recursive |
| **Terminal** | PowerShell PSReadLine, bash/zsh/fish history, WSL distros | Byte-offset cursor; extracts `# TODO:` style markers |
| **tmux** | Live panes via `tmux list-panes` | Polls every 5 min |
| **Shell hook** | Every new shell window | HTTP endpoint at `127.0.0.1:47123` pinged from `$PROFILE` / `.bashrc` |

### Lifecycle automation
- **GitHub PRs** — `draft → in_progress`, `open → in_progress`, `changes_requested → blocked`, `merged → done`, `closed → blocked`
- **Linear states** — `started → in_progress`, `completed → done`, `canceled → blocked`, `triage/backlog/unstarted → todo`
- Status changes logged as events, visible in the Activity tab and per-task lifecycle view

### UI
- **Tray-only** popover toggled by `Ctrl/Cmd+Shift+Space` global hotkey
- **Linear-style dark UI** — minimal, premium feel, 380×540 menubar window
- **Tabs:** Today, Stalled (>6h untouched), All, Done, Activity (event timeline)
- **Search + source filter** — text match across title/tags/notes; toggle source chips
- **Task detail modal** — single click on any task: editable title/notes/tags, status dropdown, lifecycle history
- **Command palette** — `Cmd/Ctrl+K`: run collectors, jump to tasks, sync, settings, check updates
- **Stalled detector** — tray badge with count + EOD nudge for tasks idle >6h

### Reliability
- **LLM reconciler** — Haiku 4.5 reviews prompts the strict heuristic rejected, dedupes against existing tasks. Prompt caching enabled. ~$0.005/run.
- **Auto-update** via electron-updater, GitHub releases as the feed
- **228 unit tests** gating every push and release across Windows/macOS/Linux
- **Encrypted credentials** via Electron `safeStorage` (OS keychain on macOS, DPAPI on Windows)

## Stack

Electron 32 · TypeScript · React 18 · Vite · sql.js (pure-WASM SQLite, zero native build) · Anthropic SDK · electron-updater · electron-store with safeStorage encryption.

## Develop

```bash
npm install
npm run dev          # launches Electron with hot reload
npm test             # 228 tests, ~1s
npm run typecheck
npm run package      # builds installer for current platform
```

Releases are tag-driven: push `vX.Y.Z` and the matrix workflow ships Windows / macOS-arm64 / macOS-x64 / Linux binaries with auto-generated notes.

## Configure

Open Settings (gear icon) — first launch shows an onboarding wizard that walks through these:

1. **GitHub** — paste a PAT (`repo` + `read:user` scopes) at [github.com/settings/tokens/new](https://github.com/settings/tokens/new), or rely on `gh auth login`. Optional include/exclude repo filters.
2. **Linear** — paste a personal API key from [linear.app/settings/api](https://linear.app/settings/api). Optional team-key filter.
3. **Slack** — paste a user OAuth token (xoxp-…). Required scopes: `im:history, mpim:history, channels:history, groups:history, users:read, channels:read, groups:read, im:read, mpim:read`. Toggle DMs / mentions independently.
4. **Anthropic API key** — required only for the LLM reconciler. Stored encrypted via OS keychain.
5. **Shell hook** — pick your shell, click Install. Writes a marker-delimited block to your profile config and backs the original up to `.trail.bak`.

## Architecture

```
src/
  main/                     # Electron main process
    db.ts                   # sql.js + repos (tasks, events)
    settings.ts             # encrypted config (API keys, tokens, prefs)
    reconciler.ts           # LLM dedup pass over events
    hookServer.ts           # 127.0.0.1:47123 shell-hook endpoint
    watcher.ts              # fs.watch on AI session log dirs
    updater.ts              # electron-updater wiring
    nudge.ts                # EOD + morning notifications
    tray.ts                 # menu bar icon
    installHook.ts          # one-click profile installer
    collectors/             # github, linear, slack, claude, codex,
                            #   opencode, terminal, tmux
  preload/                  # context bridge
  renderer/                 # React UI (Linear-style)
    components/             # TaskItem, TaskDetail, Settings,
                            #   Onboarding, Activity, CommandPalette,
                            #   UpdateBanner, ErrorBoundary
  shared/                   # shared TS types
tests/                      # vitest (unit, no UI)
resources/hooks/            # trail-hook.ps1, trail-hook.sh
.github/workflows/          # ci.yml, release.yml
```

## Keyboard

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd+Shift+Space` | Toggle popover (global) |
| `Ctrl/Cmd+K` | Command palette |
| `Ctrl/Cmd+F` | Focus search |
| `Esc` | Clear filters → close popover |
| `Cmd+Enter` (in detail view) | Save edits |

## License

MIT — see [LICENSE](LICENSE).
