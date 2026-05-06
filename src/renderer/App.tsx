import React, { useEffect, useMemo, useState } from 'react';
import { useStore, selectFiltered } from './store';
import { TaskItem } from './components/TaskItem';
import { CommandPalette } from './components/CommandPalette';
import { Settings } from './components/Settings';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RefreshIcon, PlusIcon, SettingsIcon } from './icons';

declare global {
  interface Window {
    trailEvents: {
      onChange: (cb: () => void) => () => void;
      onSync: (cb: () => void) => () => void;
    };
  }
}

const TABS: { id: 'today' | 'all' | 'stalled' | 'done'; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'stalled', label: 'Stalled' },
  { id: 'all', label: 'All' },
  { id: 'done', label: 'Done' },
];

export function App(): JSX.Element {
  const tasks = useStore((s) => s.tasks);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const refresh = useStore((s) => s.refresh);
  const sync = useStore((s) => s.sync);
  const syncing = useStore((s) => s.syncing);
  const add = useStore((s) => s.add);

  const [draft, setDraft] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const filtered = useMemo(() => selectFiltered({ tasks, filter } as any), [tasks, filter]);

  useEffect(() => {
    void refresh();
    const offChange = window.trailEvents.onChange(() => void refresh());
    const offSync = window.trailEvents.onSync(() => void sync());
    return () => {
      offChange();
      offSync();
    };
  }, [refresh, sync]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === 'Escape' && !paletteOpen) {
        window.dispatchEvent(new CustomEvent('trail:hide'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen]);

  const counts = useMemo(() => {
    const now = Date.now();
    const sixHours = 6 * 3600_000;
    return {
      today: tasks.filter(
        (t) => t.status !== 'done' && (t.snoozedUntil == null || t.snoozedUntil < now),
      ).length,
      stalled: tasks.filter(
        (t) =>
          (t.status === 'todo' || t.status === 'in_progress') &&
          (t.snoozedUntil == null || t.snoozedUntil < now) &&
          t.lastTouchedAt < now - sixHours,
      ).length,
      all: tasks.length,
      done: tasks.filter((t) => t.status === 'done').length,
    };
  }, [tasks]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    await add(draft);
    setDraft('');
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">Trail</div>
        <button
          className={`header-btn ${syncing ? 'spin' : ''}`}
          title="Sync collectors"
          onClick={() => void sync()}
          disabled={syncing}
        >
          <RefreshIcon />
        </button>
        <button
          className="header-btn"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon />
        </button>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${filter === t.id ? 'active' : ''}`}
            onClick={() => setFilter(t.id)}
          >
            {t.label}
            <span className="count">{counts[t.id]}</span>
          </button>
        ))}
      </nav>

      <form className="quick-add" onSubmit={submit}>
        <PlusIcon />
        <input
          className="quick-add-input"
          placeholder="Add a task…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
      </form>

      <div className="list">
        {filtered.length === 0 ? (
          <div className="empty">
            {filter === 'today'
              ? 'Nothing on your plate. Sync or add a task.'
              : `No ${filter} tasks.`}
          </div>
        ) : (
          filtered.map((t) => <TaskItem key={t.id} task={t} />)
        )}
      </div>

      <footer className="footer">
        <span>{tasks.length} total</span>
        <div className="footer-spacer" />
        <button className="footer-link" onClick={() => setPaletteOpen(true)}>
          <kbd>⌘</kbd>
          <kbd>K</kbd>
          <span>commands</span>
        </button>
      </footer>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenSettings={() => {
          setPaletteOpen(false);
          setSettingsOpen(true);
        }}
      />
      <ErrorBoundary>
        <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </ErrorBoundary>
    </div>
  );
}
