import { create } from 'zustand';
import type { Task, TaskStatus } from '@shared/types';

interface State {
  tasks: Task[];
  loading: boolean;
  syncing: boolean;
  filter: 'today' | 'all' | 'stalled' | 'done' | 'activity';
  setFilter: (f: State['filter']) => void;
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

  setFilter: (filter) => set({ filter }),

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

export function selectFiltered(s: State): Task[] {
  const now = Date.now();
  switch (s.filter) {
    case 'today':
      return s.tasks.filter(
        (t) => t.status !== 'done' && (t.snoozedUntil == null || t.snoozedUntil < now),
      );
    case 'stalled': {
      const sixHours = 6 * 3600_000;
      return s.tasks.filter(
        (t) =>
          (t.status === 'todo' || t.status === 'in_progress') &&
          (t.snoozedUntil == null || t.snoozedUntil < now) &&
          t.lastTouchedAt < now - sixHours,
      );
    }
    case 'done':
      return s.tasks.filter((t) => t.status === 'done');
    case 'all':
      return s.tasks;
    case 'activity':
    default:
      return [];
  }
}
