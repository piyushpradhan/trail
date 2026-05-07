import { describe, it, expect } from 'vitest';
import { selectFiltered, sourceCounts } from '../src/renderer/store.js';
import type { Task, TaskSource } from '../src/shared/types.js';

const mkTask = (over: Partial<Task>): Task => ({
  id: over.id ?? Math.random().toString(36),
  title: over.title ?? 'task',
  source: over.source ?? 'manual',
  sourceRef: over.sourceRef ?? null,
  status: over.status ?? 'todo',
  url: over.url ?? null,
  tags: over.tags ?? [],
  notes: over.notes ?? null,
  createdAt: over.createdAt ?? 0,
  updatedAt: over.updatedAt ?? 0,
  dueAt: over.dueAt ?? null,
  snoozedUntil: over.snoozedUntil ?? null,
  lastTouchedAt: over.lastTouchedAt ?? Date.now(),
});

describe('selectFiltered — filter by tab', () => {
  const now = 1_700_000_000_000;
  const sixHours = 6 * 3600_000;

  const tasks = [
    mkTask({ id: 'a', status: 'todo', lastTouchedAt: now }),
    mkTask({ id: 'b', status: 'in_progress', lastTouchedAt: now - sixHours - 1 }), // stalled
    mkTask({ id: 'c', status: 'done', lastTouchedAt: now }),
    mkTask({ id: 'd', status: 'snoozed', snoozedUntil: now + 3600_000 }),
  ];

  it('today excludes done and currently snoozed', () => {
    const r = selectFiltered({ tasks, filter: 'today', now });
    expect(r.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('stalled requires todo/in_progress + 6h+ idle', () => {
    const r = selectFiltered({ tasks, filter: 'stalled', now });
    expect(r.map((t) => t.id)).toEqual(['b']);
  });

  it('done returns only done', () => {
    const r = selectFiltered({ tasks, filter: 'done', now });
    expect(r.map((t) => t.id)).toEqual(['c']);
  });

  it('all returns everything', () => {
    expect(selectFiltered({ tasks, filter: 'all', now })).toHaveLength(4);
  });

  it('activity returns empty (rendered separately)', () => {
    expect(selectFiltered({ tasks, filter: 'activity', now })).toEqual([]);
  });
});

describe('selectFiltered — search query', () => {
  const tasks = [
    mkTask({ id: '1', title: 'Fix auth bug', tags: ['urgent'] }),
    mkTask({ id: '2', title: 'Update README', tags: ['docs'] }),
    mkTask({ id: '3', title: 'Refactor parser', notes: 'see auth module' }),
  ];

  it('matches title substring (case-insensitive)', () => {
    expect(
      selectFiltered({ tasks, filter: 'all', searchQuery: 'AUTH' }).map((t) => t.id),
    ).toEqual(['1', '3']);
  });

  it('matches tag', () => {
    expect(
      selectFiltered({ tasks, filter: 'all', searchQuery: 'docs' }).map((t) => t.id),
    ).toEqual(['2']);
  });

  it('matches notes', () => {
    expect(
      selectFiltered({ tasks, filter: 'all', searchQuery: 'parser' }).map((t) => t.id),
    ).toEqual(['3']);
  });

  it('empty query is no-op', () => {
    expect(selectFiltered({ tasks, filter: 'all', searchQuery: '   ' })).toHaveLength(3);
  });

  it('no matches yields empty', () => {
    expect(selectFiltered({ tasks, filter: 'all', searchQuery: 'zzz' })).toHaveLength(0);
  });
});

describe('selectFiltered — source filter', () => {
  const tasks: Task[] = [
    mkTask({ id: 'g1', source: 'github' }),
    mkTask({ id: 'g2', source: 'github' }),
    mkTask({ id: 'l1', source: 'linear' }),
    mkTask({ id: 'm1', source: 'manual' }),
  ];

  it('empty Set passes all', () => {
    expect(
      selectFiltered({ tasks, filter: 'all', sourceFilter: new Set() }),
    ).toHaveLength(4);
  });

  it('single source narrows results', () => {
    const r = selectFiltered({
      tasks,
      filter: 'all',
      sourceFilter: new Set(['github'] as TaskSource[]),
    });
    expect(r.map((t) => t.id)).toEqual(['g1', 'g2']);
  });

  it('multiple sources OR semantics', () => {
    const r = selectFiltered({
      tasks,
      filter: 'all',
      sourceFilter: new Set(['linear', 'manual'] as TaskSource[]),
    });
    expect(r.map((t) => t.id).sort()).toEqual(['l1', 'm1']);
  });
});

describe('selectFiltered — combined search + source', () => {
  const tasks: Task[] = [
    mkTask({ id: '1', source: 'github', title: 'Fix auth bug' }),
    mkTask({ id: '2', source: 'linear', title: 'Fix auth bug' }),
    mkTask({ id: '3', source: 'github', title: 'Update CSS' }),
  ];

  it('intersects search + source', () => {
    const r = selectFiltered({
      tasks,
      filter: 'all',
      searchQuery: 'auth',
      sourceFilter: new Set(['github'] as TaskSource[]),
    });
    expect(r.map((t) => t.id)).toEqual(['1']);
  });
});

describe('sourceCounts', () => {
  it('counts tasks per source', () => {
    const tasks: Task[] = [
      mkTask({ source: 'github' }),
      mkTask({ source: 'github' }),
      mkTask({ source: 'linear' }),
    ];
    expect(sourceCounts(tasks)).toEqual({ github: 2, linear: 1 });
  });

  it('returns empty map for no tasks', () => {
    expect(sourceCounts([])).toEqual({});
  });
});
