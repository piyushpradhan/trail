import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { tasksRepo, eventsRepo } from '../db.js';
import { getCursor, setCursor } from './state.js';
import { scorePrompt, projectFromSlug } from './heuristics.js';

const CLAUDE_DIR = join(homedir(), '.claude', 'projects');
const DEFAULT_MAX_AGE_HOURS = 48;

interface UserLine {
  type: string;
  message?: { role?: string; content?: unknown };
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  entrypoint?: string;
}

export function extractUserText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n');
    return text || null;
  }
  return null;
}

async function processFile(slug: string, file: string): Promise<number> {
  const cursorKey = `claude:${slug}:${file}`;
  const lastUuid = getCursor(cursorKey);
  let lastSeen = lastUuid;
  let created = 0;

  const stream = createReadStream(file, { encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let passedCursor = !lastUuid;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj: UserLine;
    try {
      obj = JSON.parse(line) as UserLine;
    } catch {
      continue;
    }

    if (obj.uuid) lastSeen = obj.uuid;

    if (!passedCursor) {
      if (obj.uuid === lastUuid) passedCursor = true;
      continue;
    }

    if (obj.type !== 'user' || obj.isSidechain) continue;
    if (obj.entrypoint && obj.entrypoint !== 'cli') continue;
    const text = extractUserText(obj.message?.content);
    if (!text) continue;

    const score = scorePrompt(text);
    eventsRepo.log('collector.claude.prompt', {
      slug,
      uuid: obj.uuid,
      reason: score.reason,
      isTask: score.isTask,
      text: text.slice(0, 400),
      ts: obj.timestamp ?? null,
    });

    if (!score.isTask || !obj.uuid) continue;

    const ref = `${slug}:${obj.uuid}`;
    if (tasksRepo.bySourceRef('claude', ref)) continue;

    tasksRepo.upsertBySourceRef({
      title: score.title,
      source: 'claude',
      sourceRef: ref,
      tags: ['claude', projectFromSlug(slug)],
      notes: text.length > 300 ? text : null,
    });
    created++;
  }

  if (lastSeen && lastSeen !== lastUuid) setCursor(cursorKey, lastSeen);
  return created;
}

export async function runClaudeCollector(opts?: { maxAgeHours?: number }): Promise<{ created: number }> {
  if (!existsSync(CLAUDE_DIR)) return { created: 0 };
  const cutoff = Date.now() - (opts?.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS) * 3600_000;
  let created = 0;

  const slugs = readdirSync(CLAUDE_DIR);
  for (const slug of slugs) {
    const dir = join(CLAUDE_DIR, slug);
    let stat;
    try {
      stat = statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const f of files) {
      const full = join(dir, f);
      let fstat;
      try {
        fstat = statSync(full);
      } catch {
        continue;
      }
      if (fstat.mtimeMs < cutoff) continue;
      try {
        created += await processFile(slug, full);
      } catch (err) {
        eventsRepo.log('collector.claude.error', {
          file: f,
          message: (err as Error).message,
        });
      }
    }
  }

  eventsRepo.log('collector.claude.run', { created });
  return { created };
}
