# Changelog

All notable changes to Trail. Versions follow [SemVer](https://semver.org/).

## [1.0.0] — 2026-05-08

First stable release. Marks "all originally-scoped sources covered" milestone.

### Highlights since 0.x
- Full source coverage: GitHub PRs/issues, Linear issues, Slack DMs/mentions, Claude Code, Codex, OpenCode, terminal shells, tmux panes, shell hook for live session tracking
- Lifecycle automation: PRs auto-flip `open → in_review → merged → done`; Linear states map to task status; canceled → blocked
- Real-time updates via `fs.watch` on AI session log dirs (2s debounce)
- Auto-update via electron-updater pulling from GitHub releases
- Cross-platform packaged binaries: Windows NSIS, macOS DMG (arm64 + x64), Linux AppImage
- 228 unit tests gating every push and release

## [0.10.0] — 2026-05-08

### Added
- Task detail modal: editable title, tags, notes; status dropdown; lifecycle history filtered to the task
- `eventsRepo.byTaskId()` + `events:forTask` IPC

### Changed
- Single-click on a task opens detail (was: no-op); double-click still opens URL

## [0.9.0] — 2026-05-08

### Added
- Filter bar with text search across title/tags/notes
- Per-source toggle chips above task list
- `Cmd/Ctrl+F` focuses search; `Esc` clears active filter

### Fixed
- Hook server port collision: tests now bind to OS-picked free port; bind errors surface via Promise rejection instead of being silently logged

## [0.8.0] — 2026-05-07

### Added
- Live file-watching for Claude/Codex/OpenCode session logs (`fs.watch` with 2s debounce)
- Trailing-edge re-arm so events arriving during in-flight collector run still trigger one more pass

## [0.7.0] — 2026-05-07

### Added
- Slack collector with DMs and channel @-mention tracking
- Cursor-based incremental polling per channel
- Configurable: enable toggle, DM/mention scopes, channel exclude list

## [0.6.1] — 2026-05-07

### Fixed
- macOS x64 dmg artifact naming (force arch suffix so workflow glob matches)

## [0.6.0] — 2026-05-07

### Added
- Auto-update via electron-updater
- UpdateBanner UI (downloading %, ready-to-install with restart button)
- "Check for updates" command in palette
- macOS x64 dmg in addition to arm64

## [0.5.0] — 2026-05-07

### Added
- First-launch onboarding wizard (3 steps: GitHub, Linear, shell hook)
- "Show onboarding wizard" command in palette

## [0.4.1] — 2026-05-07

### Added
- One-click shell hook installer (writes to `$PROFILE` / `.bashrc` / `.zshrc`, idempotent, auto-backup)
- `maxAgeHours` opt on Claude/Codex/OpenCode collectors for first-time deep scans
- Proof harness (`tests/proof.integration.test.ts`, gated by `RUN_PROOF=1`)

## [0.4.0] — 2026-05-07

### Added
- Activity timeline tab — surfaces events table with per-type formatter, tone-coded rows
- App icon (programmatic chevron + accent dot)

## [0.3.0] — 2026-05-07

### Added
- Linear collector with full lifecycle: `started → in_progress`, `completed → done`, `canceled → blocked`
- Recently-completed query for last 7 days so just-merged work shows as done

## [0.2.2] — 2026-05-07

### Added
- Cross-platform release pipeline (Windows NSIS, macOS DMG, Linux AppImage)
- CI workflow (typecheck + 130 tests on every push/PR)
- Release workflow (matrix build with test gate, auto-publish on `v*` tags)

## [0.1.0] — 2026-05-06

Initial public release. Single-platform Windows installer, manual builds.

### Core
- Electron + TypeScript + React menubar app
- sql.js storage (pure WASM, zero native build)
- 6 collectors: github, claude, codex, opencode, terminal, tmux
- LLM reconciler (Haiku 4.5) for second-pass dedup with prompt cache
- GitHub PR state machine
- Local HTTP endpoint at `127.0.0.1:47123` for shell-hook integration
- Encrypted credentials via Electron `safeStorage`
- 130 unit tests
