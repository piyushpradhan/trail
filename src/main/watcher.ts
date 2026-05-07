import { watch, existsSync, type FSWatcher } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { eventsRepo } from './db.js';
import { runClaudeCollector } from './collectors/claude.js';
import { runOpencodeCollector } from './collectors/opencode.js';
import { runCodexCollector } from './collectors/codex.js';

const DEBOUNCE_MS = 2_000;

export interface WatchedSource {
  name: 'claude' | 'opencode' | 'codex';
  dir: string;
  /** Whether the dir requires recursive watching support (Linux fs.watch lacks it). */
  needsRecursive: boolean;
  run: () => Promise<{ created: number }>;
}

export interface DebounceController {
  trigger: () => void;
  flush: () => Promise<void>;
  cancel: () => void;
}

/**
 * Pure: builds a debouncer that runs `task` after `wait` ms of quiet, but at
 * most once at a time. Subsequent calls during a running task re-arm the
 * timer for after the in-flight task finishes.
 */
export function makeDebouncer<T>(
  task: () => Promise<T>,
  wait: number,
  now: () => number = Date.now,
  schedule: (cb: () => void, ms: number) => unknown = setTimeout,
  unschedule: (t: unknown) => void = (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
): DebounceController {
  let pendingTimer: unknown = null;
  let running = false;
  let trailingArmed = false;
  let lastTriggered = 0;

  const fire = async () => {
    pendingTimer = null;
    if (running) {
      trailingArmed = true;
      return;
    }
    running = true;
    try {
      await task();
    } catch {
      // task already logs internally; suppress here so debouncer stays usable
    } finally {
      running = false;
      if (trailingArmed) {
        trailingArmed = false;
        // Re-arm after the in-flight task finishes — gives any events that
        // happened during execution a chance to coalesce.
        pendingTimer = schedule(() => void fire(), wait);
      }
    }
  };

  return {
    trigger: () => {
      lastTriggered = now();
      if (pendingTimer) unschedule(pendingTimer);
      pendingTimer = schedule(() => void fire(), wait);
    },
    flush: async () => {
      if (pendingTimer) {
        unschedule(pendingTimer);
        pendingTimer = null;
      }
      await fire();
    },
    cancel: () => {
      if (pendingTimer) {
        unschedule(pendingTimer);
        pendingTimer = null;
      }
      trailingArmed = false;
    },
  };
}

const watchers: FSWatcher[] = [];
const debouncers: DebounceController[] = [];

export function discoverSources(): WatchedSource[] {
  const home = homedir();
  const sources: WatchedSource[] = [];

  const claudeDir = join(home, '.claude', 'projects');
  if (existsSync(claudeDir)) {
    sources.push({
      name: 'claude',
      dir: claudeDir,
      needsRecursive: true,
      run: () => runClaudeCollector(),
    });
  }

  const opencodePosix = join(home, '.local', 'share', 'opencode', 'storage');
  const opencodeWin = join(home, 'AppData', 'Local', 'opencode', 'storage');
  const opencodeDir = existsSync(opencodePosix)
    ? opencodePosix
    : existsSync(opencodeWin)
      ? opencodeWin
      : null;
  if (opencodeDir) {
    sources.push({
      name: 'opencode',
      dir: opencodeDir,
      needsRecursive: true,
      run: () => runOpencodeCollector(),
    });
  }

  const codexCandidates = [join(home, '.codex', 'sessions'), join(home, '.codex')];
  const codexDir = codexCandidates.find((p) => existsSync(p));
  if (codexDir) {
    sources.push({
      name: 'codex',
      dir: codexDir,
      needsRecursive: true,
      run: () => runCodexCollector(),
    });
  }

  return sources;
}

function recursiveSupported(): boolean {
  // fs.watch recursive option is supported on Windows + macOS; Linux requires Node 20+ with FSWATCH_RECURSIVE
  // We treat Linux as unsupported and fall back to root-only watching there.
  return platform() === 'win32' || platform() === 'darwin';
}

interface StartedWatcher {
  source: WatchedSource;
  debouncer: DebounceController;
  watcher: FSWatcher;
}

export function startWatchers(onChange: () => void): { started: StartedWatcher[]; skipped: WatchedSource[] } {
  const sources = discoverSources();
  const started: StartedWatcher[] = [];
  const skipped: WatchedSource[] = [];

  for (const src of sources) {
    if (src.needsRecursive && !recursiveSupported()) {
      // Linux fallback: skip — collector still runs on the 5-min poll interval.
      skipped.push(src);
      eventsRepo.log('watcher.skipped', { source: src.name, reason: 'no_recursive_watch' });
      continue;
    }

    const debouncer = makeDebouncer(async () => {
      try {
        const r = await src.run();
        eventsRepo.log('watcher.dispatched', { source: src.name, created: r.created });
        if (r.created > 0) onChange();
      } catch (err) {
        eventsRepo.log('watcher.error', { source: src.name, message: (err as Error).message });
      }
    }, DEBOUNCE_MS);

    let w: FSWatcher;
    try {
      w = watch(src.dir, { recursive: true, persistent: false }, (eventType, filename) => {
        if (typeof filename === 'string' && filename.startsWith('.')) return; // skip hidden tmp files
        debouncer.trigger();
      });
    } catch (err) {
      eventsRepo.log('watcher.error', { source: src.name, stage: 'init', message: (err as Error).message });
      continue;
    }

    watchers.push(w);
    debouncers.push(debouncer);
    started.push({ source: src, debouncer, watcher: w });
    eventsRepo.log('watcher.started', { source: src.name, dir: src.dir });
  }

  return { started, skipped };
}

export function stopWatchers(): void {
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      // ignore
    }
  }
  watchers.length = 0;
  for (const d of debouncers) d.cancel();
  debouncers.length = 0;
}
