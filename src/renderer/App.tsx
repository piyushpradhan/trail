import React, { useEffect, useMemo, useState } from 'react';
import { useStore, selectFiltered, sourceCounts } from './store';
import { TaskItem } from './components/TaskItem';
import { CommandPalette } from './components/CommandPalette';
import { Settings } from './components/Settings';
import { Activity } from './components/Activity';
import { TaskDetail } from './components/TaskDetail';
import { Onboarding } from './components/Onboarding';
import { UpdateBanner } from './components/UpdateBanner';
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

type TabId = 'today' | 'all' | 'stalled' | 'done' | 'activity';

const TABS: { id: TabId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'stalled', label: 'Stalled' },
  { id: 'all', label: 'All' },
  { id: 'done', label: 'Done' },
  { id: 'activity', label: 'Activity' },
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
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const sourceFilter = useStore((s) => s.sourceFilter);
  const toggleSourceFilter = useStore((s) => s.toggleSourceFilter);
  const clearSourceFilter = useStore((s) => s.clearSourceFilter);

  const filtered = useMemo(
    () => selectFiltered({ tasks, filter, searchQuery, sourceFilter }),
    [tasks, filter, searchQuery, sourceFilter],
  );

  const sourceCountMap = useMemo(() => sourceCounts(tasks), [tasks]);

  useEffect(() => {
    void refresh();
    void window.trail.settings.get().then((s) => {
      if (!s.onboardingComplete) setOnboardingOpen(true);
    });
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
      } else if (meta && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('.search-input');
        input?.focus();
        input?.select();
      } else if (e.key === 'Escape' && !paletteOpen) {
        if (searchQuery || sourceFilter.size > 0) {
          setSearchQuery('');
          clearSourceFilter();
        } else {
          window.dispatchEvent(new CustomEvent('trail:hide'));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, searchQuery, sourceFilter, setSearchQuery, clearSourceFilter]);

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
      activity: undefined as number | undefined,
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
            {counts[t.id] !== undefined && <span className="count">{counts[t.id]}</span>}
          </button>
        ))}
      </nav>

      <form className="quick-add" onSubmit={submit}>
        <PlusIcon />
        <input
          className="quick-add-input"
          placeholder="Add a task… (or search with ⌘F)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
      </form>

      {filter !== 'activity' && (
        <div className="filter-bar">
          <input
            className="search-input"
            placeholder="Filter…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="filter-clear" onClick={() => setSearchQuery('')}>
              ×
            </button>
          )}
          <div className="source-chips">
            {Object.entries(sourceCountMap)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([source, n]) => (
                <button
                  key={source}
                  className={`source-chip-toggle source-chip ${source} ${
                    sourceFilter.has(source as never) ? 'active' : ''
                  }`}
                  onClick={() => toggleSourceFilter(source as never)}
                >
                  {source}
                  <span className="count">{n}</span>
                </button>
              ))}
            {sourceFilter.size > 0 && (
              <button className="source-chip-clear" onClick={clearSourceFilter}>
                clear
              </button>
            )}
          </div>
        </div>
      )}

      <div className="list">
        {filter === 'activity' ? (
          <Activity active={true} />
        ) : filtered.length === 0 ? (
          <div className="empty">
            {searchQuery || sourceFilter.size > 0
              ? `No tasks match.`
              : filter === 'today'
                ? 'Nothing on your plate. Sync or add a task.'
                : `No ${filter} tasks.`}
          </div>
        ) : (
          filtered.map((t) => (
            <TaskItem key={t.id} task={t} onOpenDetail={() => setDetailTaskId(t.id)} />
          ))
        )}
      </div>

      <UpdateBanner />

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
      <ErrorBoundary>
        <TaskDetail taskId={detailTaskId} onClose={() => setDetailTaskId(null)} />
      </ErrorBoundary>
      <ErrorBoundary>
        <Onboarding
          open={onboardingOpen}
          onClose={() => setOnboardingOpen(false)}
          onSettingsClick={() => {
            setOnboardingOpen(false);
            setSettingsOpen(true);
          }}
        />
      </ErrorBoundary>
    </div>
  );
}
