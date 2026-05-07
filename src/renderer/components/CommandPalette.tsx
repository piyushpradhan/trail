import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Task, TaskStatus } from '@shared/types';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: 'Action' | 'Task' | 'Navigate';
  run: () => void | Promise<void>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function CommandPalette({ open, onClose, onOpenSettings }: Props): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const tasks = useStore((s) => s.tasks);
  const sync = useStore((s) => s.sync);
  const add = useStore((s) => s.add);
  const setStatus = useStore((s) => s.setStatus);
  const setFilter = useStore((s) => s.setFilter);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands: Command[] = useMemo(() => {
    const collectorNames = ['github', 'linear', 'claude', 'codex', 'opencode', 'tmux', 'terminal'] as const;
    const base: Command[] = [
      { id: 'sync', label: 'Sync all collectors', hint: 'All', group: 'Action', run: () => sync() },
      {
        id: 'reconcile',
        label: 'Reconcile rejected prompts',
        hint: 'Haiku',
        group: 'Action',
        run: () => window.trail.reconciler.run().then(() => undefined),
      },
      { id: 'settings', label: 'Open Settings', group: 'Action', run: () => onOpenSettings() },
      {
        id: 'onboarding',
        label: 'Show onboarding wizard',
        group: 'Action',
        run: () => window.trail.settings.setOnboardingComplete(false).then(() => location.reload()),
      },
      ...collectorNames.map((n) => ({
        id: `sync-${n}`,
        label: `Sync ${n}`,
        group: 'Action' as const,
        run: () => window.trail.collectors.runOne(n).then(() => undefined),
      })),
      { id: 'today', label: 'Go to Today', group: 'Navigate', run: () => setFilter('today') },
      { id: 'stalled', label: 'Go to Stalled', group: 'Navigate', run: () => setFilter('stalled') },
      { id: 'all', label: 'Go to All', group: 'Navigate', run: () => setFilter('all') },
      { id: 'done', label: 'Go to Done', group: 'Navigate', run: () => setFilter('done') },
      {
        id: 'check-updates',
        label: 'Check for updates',
        group: 'Action',
        run: () => window.trail.updater.check().then(() => undefined),
      },
      { id: 'quit', label: 'Quit Trail', group: 'Action', run: () => window.trail.app.quit() },
    ];

    if (query.trim().length > 0) {
      base.unshift({
        id: 'add-' + query,
        label: `Create task: "${query.trim()}"`,
        hint: 'Enter',
        group: 'Action',
        run: () => add(query.trim()),
      });
    }

    const taskCmds: Command[] = tasks.slice(0, 50).map<Command>((t: Task) => ({
      id: 'task-' + t.id,
      label: t.title,
      hint: t.status === 'done' ? 'Reopen' : t.status === 'in_progress' ? 'Mark done' : 'Start',
      group: 'Task',
      run: () => {
        const next: TaskStatus =
          t.status === 'todo' ? 'in_progress' : t.status === 'in_progress' ? 'done' : 'todo';
        return setStatus(t.id, next);
      },
    }));

    return [...base, ...taskCmds];
  }, [tasks, query, sync, add, setStatus, setFilter, onOpenSettings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (cursor >= filtered.length) setCursor(0);
  }, [filtered.length, cursor]);

  if (!open) return null;

  const run = async (c: Command) => {
    await c.run();
    onClose();
  };

  const onKey = async (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = filtered[cursor];
      if (c) await run(c);
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command or task…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                className={`palette-item ${i === cursor ? 'active' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => void run(c)}
              >
                <span className="palette-group">{c.group}</span>
                <span className="palette-label">{c.label}</span>
                {c.hint && <span className="palette-hint">{c.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
