import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

interface CollectorState {
  cursors: Record<string, string>;
}

let cache: CollectorState | null = null;
let path: string | null = null;

function file(): string {
  if (path) return path;
  const dir = join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  path = join(dir, 'collectors.json');
  return path;
}

function load(): CollectorState {
  if (cache) return cache;
  const f = file();
  if (!existsSync(f)) {
    cache = { cursors: {} };
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(f, 'utf-8')) as CollectorState;
    if (!cache.cursors) cache.cursors = {};
  } catch {
    cache = { cursors: {} };
  }
  return cache;
}

function save(): void {
  if (!cache) return;
  writeFileSync(file(), JSON.stringify(cache, null, 2));
}

export function getCursor(key: string): string | undefined {
  return load().cursors[key];
}

export function setCursor(key: string, value: string): void {
  load().cursors[key] = value;
  save();
}
