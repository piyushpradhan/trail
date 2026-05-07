import { create } from 'zustand';
import type { Task, TaskStatus, TaskSource } from '@shared/types';

interface State {
  tasks: Task[];
  loading: boolean;
  syncing: boolean;
  filter: 'today' | 'all' | 'stalled' | 'done' | 'activity';
  setFilter: (f: State['filter']) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  sourceFilter: Set<TaskSource>;
  toggleSourceFilter: (s: TaskSource) => void;
  clearSourceFilter: () => void;
  refresh: () => Promise<void>;
  sync: () => Promise<void>;
  add: (title: string) => Promise<void>;
  setStatus: (id: string, status: TaskStatus) => Promise<void>;
  snooze: (id: string, hours: number) => Promise<void>;
  remove: (id: string) => Promise<void>;
  open: (id: string) => void;
}

export const useStore = create<State>((set, get) => ({
  tasks: [],
  loading: true,
  syncing: false,
  filter: 'today',
  searchQuery: '',
  sourceFilter: new Set(),

  setFilter: (filter) => set({ filter }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  toggleSourceFilter: (s) =>
    set((state) => {
      const next = new Set(state.sourceFilter);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return { sourceFilter: next };
    }),

  clearSourceFilter: () => set({ sourceFilter: new Set() }),

  refresh: async () => {
    const tasks = await window.trail.tasks.list();
    set({ tasks, loading: false });
  },

  sync: async () => {
    set({ syncing: true });
    try {
      await window.trail.collectors.runAll();
      await get().refresh();
    } finally {
      set({ syncing: false });
    }
  },

  add: async (title) => {
    const t = title.trim();
    if (!t) return;
    await window.trail.tasks.create({ title: t });
    await get().refresh();
  },

  setStatus: async (id, status) => {
    await window.trail.tasks.setStatus(id, status);
    await get().refresh();
  },

  snooze: async (id, hours) => {
    await window.trail.tasks.snooze(id, Date.now() + hours * 3600_000);
    await get().refresh();
  },

  remove: async (id) => {
    await window.trail.tasks.remove(id);
    await get().refresh();
  },

  open: (id) => {
    const t = get().tasks.find((x) => x.id === id);
    if (t?.url) window.trail.app.openExternal(t.url);
  },
}));

interface FilterArgs {
  tasks: Task[];
  filter: State['filter'];
  searchQuery?: string;
  sourceFilter?: Set<TaskSource> | ReadonlySet<TaskSource>;
  now?: number;
}

export function selectFiltered({
  tasks,
  filter,
  searchQuery = '',
  sourceFilter,
  now = Date.now(),
}: FilterArgs): Task[] {
  let scoped: Task[];
  switch (filter) {
    case 'today':
      scoped = tasks.filter(
        (t) => t.status !== 'done' && (t.snoozedUntil == null || t.snoozedUntil < now),
      );
      break;
    case 'stalled': {
      const sixHours = 6 * 3600_000;
      scoped = tasks.filter(
        (t) =>
          (t.status === 'todo' || t.status === 'in_progress') &&
          (t.snoozedUntil == null || t.snoozedUntil < now) &&
          t.lastTouchedAt < now - sixHours,
      );
      break;
    }
    case 'done':
      scoped = tasks.filter((t) => t.status === 'done');
      break;
    case 'all':
      scoped = tasks;
      break;
    case 'activity':
    default:
      return [];
  }

  if (sourceFilter && sourceFilter.size > 0) {
    scoped = scoped.filter((t) => sourceFilter.has(t.source));
  }

  const q = searchQuery.trim().toLowerCase();
  if (q) {
    scoped = scoped.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        (t.notes ?? '').toLowerCase().includes(q),
    );
  }

  return scoped;
}

export function sourceCounts(tasks: Task[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tasks) out[t.source] = (out[t.source] ?? 0) + 1;
  return out;
}
