import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tasksRepo, eventsRepo } from '../db.js';
import { scorePrompt } from './heuristics.js';

const ROOTS = [
  join(homedir(), '.local', 'share', 'opencode', 'storage'),
  join(homedir(), 'AppData', 'Local', 'opencode', 'storage'),
];
const DEFAULT_MAX_AGE_HOURS = 48;

interface MessageJson {
  id?: string;
  sessionID?: string;
  role?: string;
  time?: { created?: number };
  summary?: { title?: string };
}

function findRoot(): string | null {
  for (const r of ROOTS) if (existsSync(r)) return r;
  return null;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function collectPartsText(partsDir: string, messageId: string): string {
  const dir = join(partsDir, messageId);
  if (!existsSync(dir)) return '';
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return '';
  }
  const chunks: string[] = [];
  for (const f of entries) {
    if (!f.endsWith('.json')) continue;
    const p = readJson<{ type?: string; text?: string }>(join(dir, f));
    if (p?.type === 'text' && typeof p.text === 'string') chunks.push(p.text);
  }
  return chunks.join('\n').trim();
}

export async function runOpencodeCollector(opts?: { maxAgeHours?: number }): Promise<{ created: number }> {
  const root = findRoot();
  if (!root) return { created: 0 };

  const messageRoot = join(root, 'message');
  const partRoot = join(root, 'part');
  if (!existsSync(messageRoot)) return { created: 0 };

  const cutoff = Date.now() - (opts?.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS) * 3600_000;
  let created = 0;

  let sessions: string[];
  try {
    sessions = readdirSync(messageRoot);
  } catch {
    return { created: 0 };
  }

  for (const sessionId of sessions) {
    const sessionDir = join(messageRoot, sessionId);
    let s;
    try {
      s = statSync(sessionDir);
    } catch {
      continue;
    }
    if (!s.isDirectory() || s.mtimeMs < cutoff) continue;

    let files: string[];
    try {
      files = readdirSync(sessionDir).filter((f) => f.endsWith('.json'));
    } catch {
      continue;
    }

    for (const f of files) {
      const full = join(sessionDir, f);
      let fstat;
      try {
        fstat = statSync(full);
      } catch {
        continue;
      }
      if (fstat.mtimeMs < cutoff) continue;

      const msg = readJson<MessageJson>(full);
      if (!msg || msg.role !== 'user' || !msg.id) continue;

      const partsText = collectPartsText(partRoot, msg.id);
      const candidate = (msg.summary?.title?.trim() || partsText).trim();
      if (!candidate) continue;

      const score = scorePrompt(candidate);
      eventsRepo.log('collector.opencode.prompt', {
        sessionId,
        msgId: msg.id,
        reason: score.reason,
        isTask: score.isTask,
        text: candidate.slice(0, 400),
      });
      if (!score.isTask) continue;

      const ref = msg.id;
      if (tasksRepo.bySourceRef('opencode', ref)) continue;

      tasksRepo.upsertBySourceRef({
        title: score.title,
        source: 'opencode',
        sourceRef: ref,
        tags: ['opencode'],
        notes: partsText.length > 300 ? partsText : null,
      });
      created++;
    }
  }

  eventsRepo.log('collector.opencode.run', { created });
  return { created };
}
