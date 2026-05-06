import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { tasksRepo, eventsRepo } from '../db.js';
import { getCursor, setCursor } from './state.js';
import { scorePrompt } from './heuristics.js';

const CANDIDATE_DIRS = [
  join(homedir(), '.codex', 'sessions'),
  join(homedir(), '.codex'),
];
const MAX_AGE_HOURS = 48;

function findRoot(): string | null {
  for (const d of CANDIDATE_DIRS) if (existsSync(d)) return d;
  return null;
}

interface CodexEvent {
  role?: string;
  content?: unknown;
  type?: string;
  id?: string;
  ts?: string;
  timestamp?: string;
}

export function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((b: any) => (b?.type === 'text' || b?.type === 'input_text') && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n');
    return text || null;
  }
  if (content && typeof content === 'object' && 'text' in (content as any)) {
    const t = (content as any).text;
    return typeof t === 'string' ? t : null;
  }
  return null;
}

async function processFile(file: string): Promise<number> {
  const cursorKey = `codex:${file}`;
  const lastId = getCursor(cursorKey);
  let lastSeen = lastId;
  let created = 0;
  let passed = !lastId;

  const stream = createReadStream(file, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj: CodexEvent;
    try {
      obj = JSON.parse(line) as CodexEvent;
    } catch {
      continue;
    }

    const id = obj.id ?? obj.ts ?? obj.timestamp;
    if (id) lastSeen = id;
    if (!passed) {
      if (id === lastId) passed = true;
      continue;
    }

    if (obj.role !== 'user' && obj.type !== 'user_message' && obj.type !== 'message') continue;
    const text = extractText(obj.content);
    if (!text) continue;

    const score = scorePrompt(text);
    eventsRepo.log('collector.codex.prompt', {
      id,
      reason: score.reason,
      isTask: score.isTask,
      text: text.slice(0, 400),
    });
    if (!score.isTask || !id) continue;

    const ref = id;
    if (tasksRepo.bySourceRef('codex', ref)) continue;

    tasksRepo.upsertBySourceRef({
      title: score.title,
      source: 'codex',
      sourceRef: ref,
      tags: ['codex'],
      notes: text.length > 300 ? text : null,
    });
    created++;
  }

  if (lastSeen && lastSeen !== lastId) setCursor(cursorKey, lastSeen);
  return created;
}

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 3) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, out, depth + 1);
    else if (full.endsWith('.jsonl') || full.endsWith('.json')) out.push(full);
  }
}

export async function runCodexCollector(): Promise<{ created: number }> {
  const root = findRoot();
  if (!root) return { created: 0 };

  const cutoff = Date.now() - MAX_AGE_HOURS * 3600_000;
  const files: string[] = [];
  walk(root, files);

  let created = 0;
  for (const f of files) {
    let s;
    try {
      s = statSync(f);
    } catch {
      continue;
    }
    if (s.mtimeMs < cutoff) continue;
    try {
      created += await processFile(f);
    } catch (err) {
      eventsRepo.log('collector.codex.error', { file: f, message: (err as Error).message });
    }
  }

  eventsRepo.log('collector.codex.run', { created, files: files.length });
  return { created };
}
