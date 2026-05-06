import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  parseDecisions,
  eventToInput,
  applyDecisions,
  type Decision,
} from '../src/main/reconciler.js';
import { initDb, tasksRepo, eventsRepo, getDb, type RawEvent } from '../src/main/db.js';

beforeAll(async () => {
  await initDb();
});

beforeEach(() => {
  getDb().run('DELETE FROM tasks');
  getDb().run('DELETE FROM events');
});

describe('parseDecisions', () => {
  it('parses plain JSON', () => {
    const out = parseDecisions(
      JSON.stringify({
        decisions: [{ event_id: 'e1', action: 'skip', reason: 'noise' }],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.action).toBe('skip');
  });

  it('strips ```json fence', () => {
    const wrapped =
      '```json\n' + JSON.stringify({ decisions: [{ event_id: 'e1', action: 'skip', reason: 'r' }] }) + '\n```';
    expect(parseDecisions(wrapped)).toHaveLength(1);
  });

  it('throws on missing decisions field', () => {
    expect(() => parseDecisions(JSON.stringify({ items: [] }))).toThrow(/decisions/);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseDecisions('not json')).toThrow();
  });
});

describe('eventToInput', () => {
  it('maps event with text payload', () => {
    const e: RawEvent = {
      id: 'e1',
      taskId: null,
      type: 'collector.claude.prompt',
      payload: { text: 'hello', isTask: false },
      ts: 1700000000000,
      processedAt: null,
    };
    const r = eventToInput(e);
    expect(r).not.toBeNull();
    expect(r!.event_id).toBe('e1');
    expect(r!.source).toBe('claude');
    expect(r!.text).toBe('hello');
    expect(r!.when).toBe(new Date(1700000000000).toISOString());
  });

  it('rejects event without text', () => {
    const e: RawEvent = {
      id: 'e1',
      taskId: null,
      type: 'collector.codex.prompt',
      payload: { isTask: false },
      ts: 0,
      processedAt: null,
    };
    expect(eventToInput(e)).toBeNull();
  });

  it('rejects when isTask=true (already created)', () => {
    const e: RawEvent = {
      id: 'e1',
      taskId: null,
      type: 'collector.claude.prompt',
      payload: { text: 'x', isTask: true },
      ts: 0,
      processedAt: null,
    };
    expect(eventToInput(e)).toBeNull();
  });
});

describe('applyDecisions', () => {
  function logAndFetch(payload: unknown): RawEvent {
    eventsRepo.log('collector.claude.prompt', payload);
    return eventsRepo.unprocessed(['collector.claude.prompt'], 1)[0]!;
  }

  it('creates a task when action=create', () => {
    const ev = logAndFetch({ text: 'fix bug', isTask: false });
    const decisions: Decision[] = [
      { event_id: ev.id, action: 'create', title: 'Fix the bug', reason: 'imperative' },
    ];
    const r = applyDecisions([ev], decisions);
    expect(r.created).toBe(1);
    expect(tasksRepo.list()).toHaveLength(1);
    expect(tasksRepo.list()[0]!.title).toBe('Fix the bug');
    expect(tasksRepo.list()[0]!.source).toBe('claude');
  });

  it('merge increments lastTouchedAt of existing task', async () => {
    const existing = tasksRepo.create({ title: 'existing', source: 'manual' });
    await new Promise((r) => setTimeout(r, 5));
    const ev = logAndFetch({ text: 'related', isTask: false });
    const before = existing.lastTouchedAt;
    const r = applyDecisions(
      [ev],
      [{ event_id: ev.id, action: 'merge', task_id: existing.id, reason: 'dup' }],
    );
    expect(r.merged).toBe(1);
    expect(tasksRepo.byId(existing.id)!.lastTouchedAt).toBeGreaterThan(before);
  });

  it('merge with non-existent task_id falls through to skipped', () => {
    const ev = logAndFetch({ text: 'orphan', isTask: false });
    const r = applyDecisions(
      [ev],
      [{ event_id: ev.id, action: 'merge', task_id: 'nope', reason: 'x' }],
    );
    expect(r.merged).toBe(0);
    expect(r.skipped).toBe(1);
  });

  it('skip action increments skipped count', () => {
    const ev = logAndFetch({ text: 'noise', isTask: false });
    const r = applyDecisions([ev], [{ event_id: ev.id, action: 'skip', reason: 'noise' }]);
    expect(r.skipped).toBe(1);
    expect(tasksRepo.list()).toHaveLength(0);
  });

  it('marks ALL input events processed regardless of decision', () => {
    const e1 = logAndFetch({ text: 'a', isTask: false });
    eventsRepo.log('collector.claude.prompt', { text: 'b', isTask: false });
    const events = eventsRepo.unprocessed(['collector.claude.prompt'], 10);
    expect(events).toHaveLength(2);

    applyDecisions(events, [
      { event_id: e1.id, action: 'create', title: 'X', reason: 'r' },
      // intentionally leave second event without a decision entry
    ]);

    const remaining = eventsRepo.unprocessed(['collector.claude.prompt'], 10);
    expect(remaining).toHaveLength(0);
  });

  it('truncates long titles to 120 chars', () => {
    const ev = logAndFetch({ text: 'x', isTask: false });
    const longTitle = 'A'.repeat(500);
    applyDecisions(
      [ev],
      [{ event_id: ev.id, action: 'create', title: longTitle, reason: 'r' }],
    );
    expect(tasksRepo.list()[0]!.title.length).toBeLessThanOrEqual(120);
  });

  it('ignores decisions referring to unknown event_id', () => {
    const ev = logAndFetch({ text: 'x', isTask: false });
    const r = applyDecisions(
      [ev],
      [{ event_id: 'unknown', action: 'create', title: 'X', reason: 'r' }],
    );
    expect(r.created).toBe(0);
  });
});
