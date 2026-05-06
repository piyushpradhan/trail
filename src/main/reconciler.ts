import Anthropic from '@anthropic-ai/sdk';
import { eventsRepo, tasksRepo, type RawEvent } from './db.js';
import { settings } from './settings.js';
import type { TaskSource } from '@shared/types';

const MODEL = 'claude-haiku-4-5-20251001';
const SYSTEM_PROMPT = `You are a task-triage assistant for a personal task tracker called Trail.

You receive a batch of recent prompts the user typed into AI coding assistants (Claude Code, Codex, OpenCode). The user's strict heuristic already rejected these as "not obviously a task" — your job is the second-pass review.

For each prompt, decide one of:
- create: this is a real, actionable, distinct task the user is likely tracking. Return a concise imperative title (max 90 chars).
- merge: the prompt is a follow-up or duplicate of an existing open task. Return the existing task_id.
- skip: not actionable (idle question, exploration, casual chat, retry of already-tracked work, throwaway debug).

Be conservative. Default to "skip" when uncertain. The user does NOT want their task list flooded.

Respond with strict JSON in this shape and nothing else:
{
  "decisions": [
    { "event_id": "<id>", "action": "create"|"merge"|"skip", "title": "...", "task_id": "...", "reason": "<short>" }
  ]
}

Rules:
- title is required when action="create" and forbidden otherwise
- task_id is required when action="merge" and must match an existing open task
- reason is always required, max 12 words
- Output exactly one decision per input event_id, in the same order`;

export interface Decision {
  event_id: string;
  action: 'create' | 'merge' | 'skip';
  title?: string;
  task_id?: string;
  reason: string;
}

interface BatchInput {
  events: Array<{
    event_id: string;
    source: string;
    text: string;
    when: string;
  }>;
  open_tasks: Array<{
    task_id: string;
    title: string;
    source: string;
  }>;
}

const RECONCILABLE_TYPES = [
  'collector.claude.prompt',
  'collector.codex.prompt',
  'collector.opencode.prompt',
];

export function eventToInput(e: RawEvent): { event_id: string; source: string; text: string; when: string } | null {
  const p = e.payload as { text?: string; isTask?: boolean };
  if (!p?.text) return null;
  if (p.isTask === true) return null; // already created task via heuristic
  const source = e.type.split('.')[1] ?? 'unknown';
  return {
    event_id: e.id,
    source,
    text: p.text,
    when: new Date(e.ts).toISOString(),
  };
}

function buildBatch(events: RawEvent[]): BatchInput {
  const inputs = events.map(eventToInput).filter((x): x is NonNullable<typeof x> => x !== null);
  const openTasks = tasksRepo.list({ status: ['todo', 'in_progress', 'blocked'] }).map((t) => ({
    task_id: t.id,
    title: t.title,
    source: t.source,
  }));
  return { events: inputs, open_tasks: openTasks };
}

export function parseDecisions(raw: string): Decision[] {
  const trimmed = raw.trim();
  // strip code fences if Claude wrapped in markdown
  const cleaned = trimmed.replace(/^```json\s*/, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned) as { decisions?: Decision[] };
  if (!Array.isArray(parsed.decisions)) throw new Error('decisions array missing');
  return parsed.decisions;
}

export function applyDecisions(events: RawEvent[], decisions: Decision[]): { created: number; merged: number; skipped: number } {
  const eventById = new Map(events.map((e) => [e.id, e]));
  let created = 0;
  let merged = 0;
  let skipped = 0;
  const processedIds: string[] = [];

  for (const d of decisions) {
    const event = eventById.get(d.event_id);
    if (!event) continue;

    if (d.action === 'create' && d.title) {
      const source = (event.type.split('.')[1] ?? 'manual') as TaskSource;
      const sourceRef = `reconciled:${event.id}`;
      tasksRepo.upsertBySourceRef({
        title: d.title.slice(0, 120),
        source,
        sourceRef,
        tags: [source, 'reconciled'],
        notes: (event.payload as { text?: string }).text ?? null,
      });
      created++;
    } else if (d.action === 'merge' && d.task_id) {
      const existing = tasksRepo.byId(d.task_id);
      if (existing) {
        tasksRepo.update(d.task_id, { lastTouchedAt: Date.now() });
        eventsRepo.log('reconciler.merged', { event_id: event.id, into: d.task_id, reason: d.reason }, d.task_id);
        merged++;
      } else {
        skipped++;
      }
    } else {
      skipped++;
    }

    processedIds.push(event.id);
  }

  // Mark all input events processed (even ones the LLM skipped or failed to address)
  // so we don't re-process them next run.
  const allIds = events.map((e) => e.id);
  eventsRepo.markProcessed(allIds);

  eventsRepo.log('reconciler.run', { total: events.length, created, merged, skipped });
  return { created, merged, skipped };
}

export interface ReconcileResult {
  attempted: number;
  created: number;
  merged: number;
  skipped: number;
  reason?: string;
}

export async function runReconciler(): Promise<ReconcileResult> {
  if (!settings.getReconciler().enabled) {
    return { attempted: 0, created: 0, merged: 0, skipped: 0, reason: 'disabled' };
  }

  const apiKey = settings.getApiKey();
  if (!apiKey) {
    return { attempted: 0, created: 0, merged: 0, skipped: 0, reason: 'no_api_key' };
  }

  const limit = settings.getReconciler().maxEventsPerRun;
  const events = eventsRepo.unprocessed(RECONCILABLE_TYPES, limit);
  if (events.length === 0) {
    return { attempted: 0, created: 0, merged: 0, skipped: 0, reason: 'no_events' };
  }

  const batch = buildBatch(events);
  if (batch.events.length === 0) {
    eventsRepo.markProcessed(events.map((e) => e.id));
    return { attempted: 0, created: 0, merged: 0, skipped: 0, reason: 'no_text_in_events' };
  }

  const client = new Anthropic({ apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: JSON.stringify(batch),
        },
      ],
    });
  } catch (err) {
    eventsRepo.log('reconciler.error', { message: (err as Error).message });
    throw err;
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    eventsRepo.log('reconciler.error', { message: 'no text response' });
    return { attempted: events.length, created: 0, merged: 0, skipped: 0, reason: 'no_response' };
  }

  let decisions: Decision[];
  try {
    decisions = parseDecisions(textBlock.text);
  } catch (err) {
    eventsRepo.log('reconciler.parse_error', {
      message: (err as Error).message,
      preview: textBlock.text.slice(0, 300),
    });
    return { attempted: events.length, created: 0, merged: 0, skipped: 0, reason: 'parse_error' };
  }

  const result = applyDecisions(events, decisions);
  return { attempted: events.length, ...result };
}
