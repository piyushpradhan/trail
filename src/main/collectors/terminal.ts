import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { existsSync, statSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { tasksRepo, eventsRepo } from '../db.js';
import { getCursor, setCursor } from './state.js';

interface ShellSource {
  name: string;
  path: string;
  parseLine?: (line: string) => { cmd: string; ts: number | null };
}

export interface TerminalDiagnostic {
  platform: NodeJS.Platform;
  discovered: Array<{ name: string; path: string; sizeBytes: number; mtime: number }>;
  attempted: Array<{ name: string; path: string; reason: string }>;
}

export function parseZshExtended(line: string): { cmd: string; ts: number | null } {
  const m = /^:\s+(\d+):\d+;(.*)$/.exec(line);
  if (m && m[1] && m[2] !== undefined) {
    return { cmd: m[2], ts: parseInt(m[1], 10) * 1000 };
  }
  return { cmd: line, ts: null };
}

export const TERMINAL_TODO_RE = /(?:#|\/\/|--|::)\s*(TODO|TASK|FIXME|FOLLOW[- ]?UP)\b\s*[:\-]?\s*(.+)/i;

function pushIfExists(
  sources: ShellSource[],
  attempted: TerminalDiagnostic['attempted'],
  src: ShellSource,
): void {
  if (existsSync(src.path)) {
    sources.push(src);
  } else {
    attempted.push({ name: src.name, path: src.path, reason: 'not found' });
  }
}

function discoverShells(): { sources: ShellSource[]; attempted: TerminalDiagnostic['attempted'] } {
  const home = homedir();
  const sources: ShellSource[] = [];
  const attempted: TerminalDiagnostic['attempted'] = [];
  const plat = platform();

  // ---------- Windows ----------
  if (plat === 'win32') {
    // PowerShell 5.1 (built-in)
    pushIfExists(sources, attempted, {
      name: 'powershell-5',
      path: join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'),
    });
    // PowerShell 7+ (pwsh)
    pushIfExists(sources, attempted, {
      name: 'pwsh-7',
      path: join(home, 'AppData', 'Roaming', 'Microsoft', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'),
    });
    // Some installs (per-user, scoped) use Local instead of Roaming
    pushIfExists(sources, attempted, {
      name: 'powershell-5-local',
      path: join(home, 'AppData', 'Local', 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'),
    });
    pushIfExists(sources, attempted, {
      name: 'pwsh-7-local',
      path: join(home, 'AppData', 'Local', 'Microsoft', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt'),
    });
    // Git Bash on Windows
    pushIfExists(sources, attempted, { name: 'git-bash', path: join(home, '.bash_history') });
  }

  // ---------- macOS / Linux ----------
  if (plat === 'darwin' || plat === 'linux') {
    pushIfExists(sources, attempted, { name: 'bash', path: join(home, '.bash_history') });
    pushIfExists(sources, attempted, {
      name: 'zsh',
      path: join(home, '.zsh_history'),
      parseLine: parseZshExtended,
    });
    pushIfExists(sources, attempted, {
      name: 'fish',
      path: join(home, '.local', 'share', 'fish', 'fish_history'),
    });
    // pwsh on mac/linux
    pushIfExists(sources, attempted, {
      name: 'pwsh',
      path: join(home, '.local', 'share', 'powershell', 'PSReadLine', 'ConsoleHost_history.txt'),
    });
    // macOS-specific pwsh location
    if (plat === 'darwin') {
      pushIfExists(sources, attempted, {
        name: 'pwsh-mac',
        path: join(home, 'Library', 'Application Support', 'powershell', 'PSReadLine', 'ConsoleHost_history.txt'),
      });
    }
  }

  // ---------- WSL passthrough (Windows host only) ----------
  if (plat === 'win32') {
    try {
      const distros = readdirSync('\\\\wsl$\\');
      for (const d of distros) {
        const wslRoot = `\\\\wsl$\\${d}\\root\\.bash_history`;
        if (existsSync(wslRoot)) sources.push({ name: `wsl:${d}:root:bash`, path: wslRoot });
        try {
          const users = readdirSync(`\\\\wsl$\\${d}\\home`);
          for (const u of users) {
            const b = `\\\\wsl$\\${d}\\home\\${u}\\.bash_history`;
            if (existsSync(b)) sources.push({ name: `wsl:${d}:${u}:bash`, path: b });
            const z = `\\\\wsl$\\${d}\\home\\${u}\\.zsh_history`;
            if (existsSync(z))
              sources.push({ name: `wsl:${d}:${u}:zsh`, path: z, parseLine: parseZshExtended });
          }
        } catch {
          /* no /home dir */
        }
      }
    } catch {
      attempted.push({ name: 'wsl', path: '\\\\wsl$\\', reason: 'WSL not installed or unreachable' });
    }
  }

  return { sources, attempted };
}

export function readSinceOffset(path: string, offset: number): { text: string; nextOffset: number } {
  const stat = statSync(path);
  if (stat.size <= offset) {
    return { text: '', nextOffset: stat.size };
  }
  const fd = openSync(path, 'r');
  try {
    const len = stat.size - offset;
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, offset);
    return { text: buf.toString('utf8'), nextOffset: stat.size };
  } finally {
    closeSync(fd);
  }
}

interface ProcessResult {
  commands: number;
  todos: number;
}

function processSource(src: ShellSource): ProcessResult {
  const cursorKey = `terminal:${src.path}`;
  const stored = getCursor(cursorKey);
  const offset = stored ? parseInt(stored, 10) : 0;
  const { text, nextOffset } = readSinceOffset(src.path, offset);

  if (!text) {
    setCursor(cursorKey, String(nextOffset));
    return { commands: 0, todos: 0 };
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let commands = 0;
  let todos = 0;
  const sample: string[] = [];

  for (const rawLine of lines) {
    const parsed = src.parseLine ? src.parseLine(rawLine) : { cmd: rawLine, ts: null };
    const cmd = parsed.cmd.trim();
    if (!cmd) continue;

    // TODO/FIXME comments anywhere in the line
    const m = TERMINAL_TODO_RE.exec(rawLine);
    if (m) {
      const body = m[2]?.trim() ?? '';
      if (body.length >= 5) {
        const ref = `${src.name}:${body.slice(0, 80)}`;
        if (!tasksRepo.bySourceRef('tmux', ref)) {
          tasksRepo.upsertBySourceRef({
            title: body.slice(0, 119),
            source: 'tmux',
            sourceRef: ref,
            tags: ['terminal', src.name],
            notes: `From ${src.name} history`,
          });
          todos++;
        }
      }
    }

    // Skip pure comment lines from command count
    if (cmd.startsWith('#')) continue;
    commands++;
    if (sample.length < 10) sample.push(cmd.slice(0, 200));
  }

  if (commands > 0 || todos > 0) {
    eventsRepo.log('collector.terminal.activity', {
      source: src.name,
      commands,
      todos,
      sample,
    });
  }

  setCursor(cursorKey, String(nextOffset));
  return { commands, todos };
}

export async function runTerminalCollector(): Promise<{ created: number }> {
  const { sources, attempted } = discoverShells();

  if (sources.length === 0) {
    eventsRepo.log('collector.terminal.run', {
      sources: 0,
      created: 0,
      attempted,
      hint: 'No shell history files found. Run a few commands in PowerShell/bash to seed history.',
    });
    return { created: 0 };
  }

  let created = 0;
  let totalCmds = 0;
  const perShell: Array<{ name: string; commands: number }> = [];

  for (const s of sources) {
    try {
      const r = processSource(s);
      created += r.todos;
      totalCmds += r.commands;
      perShell.push({ name: s.name, commands: r.commands });
    } catch (err) {
      eventsRepo.log('collector.terminal.error', {
        source: s.name,
        message: (err as Error).message,
      });
    }
  }

  eventsRepo.log('collector.terminal.run', {
    sources: sources.length,
    discovered: sources.map((s) => s.name),
    commands: totalCmds,
    created,
    perShell,
  });
  return { created };
}

export function diagnoseTerminal(): TerminalDiagnostic {
  const { sources, attempted } = discoverShells();
  return {
    platform: platform(),
    discovered: sources.map((s) => {
      try {
        const st = statSync(s.path);
        return { name: s.name, path: s.path, sizeBytes: st.size, mtime: st.mtimeMs };
      } catch {
        return { name: s.name, path: s.path, sizeBytes: 0, mtime: 0 };
      }
    }),
    attempted,
  };
}
