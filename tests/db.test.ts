import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, tasksRepo, eventsRepo, getDb, saveDbNow } from '../src/main/db.js';

beforeAll(async () => {
  await initDb();
});

beforeEach(() => {
  // wipe all tables between tests for isolation
  getDb().run('DELETE FROM tasks');
  getDb().run('DELETE FROM events');
});

describe('tasksRepo.create', () => {
  it('creates with required fields and defaults', () => {
    const t = tasksRepo.create({ title: '  hello world  ' });
    expect(t.title).toBe('hello world');
    expect(t.source).toBe('manual');
    expect(t.status).toBe('todo');
    expect(t.tags).toEqual([]);
    expect(t.createdAt).toBeGreaterThan(0);
    expect(t.updatedAt).toBe(t.createdAt);
    expect(t.lastTouchedAt).toBe(t.createdAt);
    expect(t.snoozedUntil).toBeNull();
  });

  it('persists fields including arrays', () => {
    const t = tasksRepo.create({
      title: 'x',
      source: 'github',
      sourceRef: 'owner/repo#1',
      url: 'https://github.com/owner/repo/pull/1',
      tags: ['a', 'b', 'c'],
      notes: 'notes here',
      dueAt: 12345,
    });
    const back = tasksRepo.byId(t.id);
    expect(back).not.toBeNull();
    expect(back!.tags).toEqual(['a', 'b', 'c']);
    expect(back!.notes).toBe('notes here');
    expect(back!.dueAt).toBe(12345);
  });
});

describe('tasksRepo.byId / bySourceRef', () => {
  it('returns null for missing id', () => {
    expect(tasksRepo.byId('nope')).toBeNull();
  });

  it('returns null when sourceRef does not exist', () => {
    expect(tasksRepo.bySourceRef('github', 'nope')).toBeNull();
  });

  it('looks up by source+sourceRef', () => {
    const t = tasksRepo.create({ title: 'x', source: 'github', sourceRef: 'r#1' });
    expect(tasksRepo.bySourceRef('github', 'r#1')!.id).toBe(t.id);
  });

  it('does not collide when same ref under different source', () => {
    tasksRepo.create({ title: 'a', source: 'github', sourceRef: 'k1' });
    tasksRepo.create({ title: 'b', source: 'codex', sourceRef: 'k1' });
    expect(tasksRepo.bySourceRef('github', 'k1')!.title).toBe('a');
    expect(tasksRepo.bySourceRef('codex', 'k1')!.title).toBe('b');
  });
});

describe('tasksRepo.upsertBySourceRef', () => {
  it('creates when missing', () => {
    const t = tasksRepo.upsertBySourceRef({ title: 'new', source: 'github', sourceRef: 'r1' });
    expect(t.title).toBe('new');
    expect(tasksRepo.list()).toHaveLength(1);
  });

  it('updates title+url when existing', async () => {
    const first = tasksRepo.upsertBySourceRef({
      title: 'old',
      source: 'github',
      sourceRef: 'r1',
      url: 'u1',
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = tasksRepo.upsertBySourceRef({
      title: 'new',
      source: 'github',
      sourceRef: 'r1',
      url: 'u2',
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('new');
    expect(second.url).toBe('u2');
    expect(tasksRepo.list()).toHaveLength(1);
  });

  it('preserves existing url when new url is undefined', () => {
    tasksRepo.upsertBySourceRef({ title: 'a', source: 'github', sourceRef: 'r', url: 'http://x' });
    const after = tasksRepo.upsertBySourceRef({ title: 'b', source: 'github', sourceRef: 'r' });
    expect(after.url).toBe('http://x');
  });

  it('falls back to create when sourceRef missing (cannot dedupe)', () => {
    const a = tasksRepo.upsertBySourceRef({ title: 'a', source: 'manual' });
    const b = tasksRepo.upsertBySourceRef({ title: 'a', source: 'manual' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('tasksRepo.update', () => {
  it('throws on missing id', () => {
    expect(() => tasksRepo.update('nope', { title: 'x' })).toThrow(/not found/);
  });

  it('preserves id even when patch provides new id', () => {
    const t = tasksRepo.create({ title: 'x' });
    const updated = tasksRepo.update(t.id, { id: 'spoofed', title: 'y' } as any);
    expect(updated.id).toBe(t.id);
    expect(updated.title).toBe('y');
  });

  it('bumps updatedAt', async () => {
    const t = tasksRepo.create({ title: 'x' });
    await new Promise((r) => setTimeout(r, 5));
    const u = tasksRepo.update(t.id, { title: 'y' });
    expect(u.updatedAt).toBeGreaterThan(t.updatedAt);
  });
});

describe('tasksRepo.list filtering + ordering', () => {
  it('orders by status (done last) then last_touched_at desc', async () => {
    const a = tasksRepo.create({ title: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    const b = tasksRepo.create({ title: 'b' });
    await new Promise((r) => setTimeout(r, 5));
    const c = tasksRepo.create({ title: 'c' });
    tasksRepo.update(a.id, { status: 'done' });
    const ids = tasksRepo.list().map((t) => t.id);
    expect(ids[0]).toBe(c.id);
    expect(ids[1]).toBe(b.id);
    expect(ids[2]).toBe(a.id); // done last
  });

  it('filters by status array', () => {
    const a = tasksRepo.create({ title: 'a' });
    tasksRepo.create({ title: 'b' });
    tasksRepo.update(a.id, { status: 'in_progress' });
    const inProg = tasksRepo.list({ status: ['in_progress'] });
    expect(inProg).toHaveLength(1);
    expect(inProg[0]!.title).toBe('a');
  });
});

describe('tasksRepo.countStalled', () => {
  it('returns 0 when nothing stalled', () => {
    tasksRepo.create({ title: 'fresh' });
    expect(tasksRepo.countStalled()).toBe(0);
  });

  it('counts only todo/in_progress tasks older than 6h', () => {
    const now = Date.now();
    const sevenH = now - 7 * 3600_000;
    const t1 = tasksRepo.create({ title: 'old todo' });
    tasksRepo.update(t1.id, { lastTouchedAt: sevenH });
    const t2 = tasksRepo.create({ title: 'old done' });
    tasksRepo.update(t2.id, { lastTouchedAt: sevenH, status: 'done' });
    const t3 = tasksRepo.create({ title: 'old snoozed' });
    tasksRepo.update(t3.id, {
      lastTouchedAt: sevenH,
      status: 'snoozed',
      snoozedUntil: now + 3600_000,
    });
    expect(tasksRepo.countStalled(now)).toBe(1);
  });

  it('excludes tasks whose snooze expired (back to active) only when status=todo/in_progress', () => {
    const now = Date.now();
    const t = tasksRepo.create({ title: 'expired snooze' });
    tasksRepo.update(t.id, {
      lastTouchedAt: now - 7 * 3600_000,
      status: 'todo',
      snoozedUntil: now - 1000,
    });
    expect(tasksRepo.countStalled(now)).toBe(1);
  });
});

describe('tasksRepo.remove', () => {
  it('removes task', () => {
    const t = tasksRepo.create({ title: 'x' });
    tasksRepo.remove(t.id);
    expect(tasksRepo.byId(t.id)).toBeNull();
  });

  it('idempotent on missing id', () => {
    expect(() => tasksRepo.remove('nope')).not.toThrow();
  });
});

describe('eventsRepo', () => {
  it('logs and queries unprocessed by type', () => {
    eventsRepo.log('a.x', { v: 1 });
    eventsRepo.log('b.x', { v: 2 });
    eventsRepo.log('a.y', { v: 3 });
    const a = eventsRepo.unprocessed(['a.x', 'a.y'], 100);
    expect(a).toHaveLength(2);
    expect(a.map((e) => e.type).sort()).toEqual(['a.x', 'a.y']);
  });

  it('returns [] for empty type list', () => {
    eventsRepo.log('a', {});
    expect(eventsRepo.unprocessed([], 100)).toEqual([]);
  });

  it('respects limit and orders by ts asc', async () => {
    for (let i = 0; i < 5; i++) {
      eventsRepo.log('t', { i });
      await new Promise((r) => setTimeout(r, 2));
    }
    const out = eventsRepo.unprocessed(['t'], 3);
    expect(out).toHaveLength(3);
    expect((out[0]!.payload as { i: number }).i).toBe(0);
    expect((out[2]!.payload as { i: number }).i).toBe(2);
  });

  it('markProcessed excludes events from subsequent unprocessed', () => {
    eventsRepo.log('t', { v: 1 });
    eventsRepo.log('t', { v: 2 });
    const first = eventsRepo.unprocessed(['t'], 10);
    eventsRepo.markProcessed([first[0]!.id]);
    const second = eventsRepo.unprocessed(['t'], 10);
    expect(second).toHaveLength(1);
    expect((second[0]!.payload as { v: number }).v).toBe(2);
  });

  it('markProcessed with empty array is a no-op', () => {
    expect(() => eventsRepo.markProcessed([])).not.toThrow();
  });

  it('recent returns events ordered by ts desc with limit', async () => {
    for (let i = 0; i < 5; i++) {
      eventsRepo.log('e.recent', { i });
      await new Promise((r) => setTimeout(r, 2));
    }
    const out = eventsRepo.recent(3);
    expect(out).toHaveLength(3);
    // newest first
    expect((out[0]!.payload as { i: number }).i).toBe(4);
    expect((out[2]!.payload as { i: number }).i).toBe(2);
  });

  it('recent with since filter excludes older events', async () => {
    eventsRepo.log('e', { v: 'old' });
    await new Promise((r) => setTimeout(r, 5));
    const cutoff = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    eventsRepo.log('e', { v: 'new' });
    const out = eventsRepo.recent(10, cutoff);
    expect(out).toHaveLength(1);
    expect((out[0]!.payload as { v: string }).v).toBe('new');
  });

  it('byTaskId returns events for a task in desc ts order', async () => {
    const t = tasksRepo.create({ title: 'x' });
    eventsRepo.log('a', { v: 1 }, t.id);
    await new Promise((r) => setTimeout(r, 2));
    eventsRepo.log('b', { v: 2 }, t.id);
    await new Promise((r) => setTimeout(r, 2));
    eventsRepo.log('unrelated', { v: 3 }); // no taskId
    const out = eventsRepo.byTaskId(t.id);
    expect(out).toHaveLength(2);
    expect((out[0]!.payload as { v: number }).v).toBe(2);
    expect((out[1]!.payload as { v: number }).v).toBe(1);
  });

  it('byTaskId honors limit', () => {
    const t = tasksRepo.create({ title: 'x' });
    for (let i = 0; i < 10; i++) eventsRepo.log('e', { i }, t.id);
    expect(eventsRepo.byTaskId(t.id, 4)).toHaveLength(4);
  });

  it('byTaskId returns empty for unknown task', () => {
    expect(eventsRepo.byTaskId('nope')).toEqual([]);
  });

  it('parses payload back as JSON', () => {
    eventsRepo.log('t', { nested: { arr: [1, 2, 3] } });
    const e = eventsRepo.unprocessed(['t'], 1)[0]!;
    expect(e.payload).toEqual({ nested: { arr: [1, 2, 3] } });
  });
});

describe('saveDbNow', () => {
  it('does not throw when DB initialized', () => {
    expect(() => saveDbNow()).not.toThrow();
  });
});
