import React, { useEffect, useMemo, useState } from 'react';
import type { ActivityEvent, Task, TaskStatus } from '@shared/types';
import { formatEvent, relTime } from '../activity';
import { useStore } from '../store';
import { ExternalIcon, SnoozeIcon, TrashIcon } from '../icons';

interface Props {
  taskId: string | null;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'snoozed', label: 'Snoozed' },
];

export function TaskDetail({ taskId, onClose }: Props): JSX.Element | null {
  const tasks = useStore((s) => s.tasks);
  const refresh = useStore((s) => s.refresh);
  const open = useStore((s) => s.open);
  const remove = useStore((s) => s.remove);
  const snooze = useStore((s) => s.snooze);

  const task = useMemo(() => tasks.find((t) => t.id === taskId) ?? null, [tasks, taskId]);

  const [titleDraft, setTitleDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [tagsDraft, setTagsDraft] = useState('');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!task) return;
    setTitleDraft(task.title);
    setNotesDraft(task.notes ?? '');
    setTagsDraft(task.tags.join(', '));
    setSavedAt(null);
  }, [task?.id, task?.updatedAt]);

  useEffect(() => {
    if (!taskId) {
      setEvents([]);
      return;
    }
    void window.trail.events.forTask(taskId, 50).then(setEvents).catch(() => undefined);
  }, [taskId]);

  if (!taskId || !task) return null;

  const dirty =
    titleDraft.trim() !== task.title ||
    notesDraft !== (task.notes ?? '') ||
    tagsDraft !==
      task.tags.join(', ');

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const tags = tagsDraft
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await window.trail.tasks.update(task.id, {
        title: titleDraft.trim() || task.title,
        notes: notesDraft.trim() ? notesDraft : null,
        tags,
      });
      await refresh();
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: TaskStatus) => {
    await window.trail.tasks.setStatus(task.id, status);
    await refresh();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="task-detail" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="settings-header">
          <span className={`source-chip ${task.source}`}>{task.source}</span>
          <select
            className="task-detail-status"
            value={task.status}
            onChange={(e) => void setStatus(e.target.value as TaskStatus)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <div className="footer-spacer" />
          {task.url && (
            <button
              className="icon-btn"
              title="Open URL"
              onClick={() => open(task.id)}
            >
              <ExternalIcon />
            </button>
          )}
          <button
            className="icon-btn"
            title="Snooze 4h"
            onClick={() => void snooze(task.id, 4)}
          >
            <SnoozeIcon />
          </button>
          <button
            className="icon-btn"
            title="Delete"
            onClick={async () => {
              await remove(task.id);
              onClose();
            }}
          >
            <TrashIcon />
          </button>
          <button className="icon-btn" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className="task-detail-body">
          <label className="task-detail-label">Title</label>
          <input
            className="task-detail-title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void save()}
            autoFocus
          />

          <label className="task-detail-label">Tags (comma-separated)</label>
          <input
            className="settings-input"
            value={tagsDraft}
            onChange={(e) => setTagsDraft(e.target.value)}
            onBlur={() => void save()}
            placeholder="urgent, q3, infra"
          />

          <label className="task-detail-label">Notes</label>
          <textarea
            className="task-detail-notes"
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={() => void save()}
            placeholder="Notes, links, context…"
            rows={5}
          />

          <div className="task-detail-meta">
            <span>
              <strong>Created</strong> {relTime(task.createdAt)} ago
            </span>
            <span>
              <strong>Updated</strong> {relTime(task.updatedAt)} ago
            </span>
            <span>
              <strong>Touched</strong> {relTime(task.lastTouchedAt)} ago
            </span>
            {task.url && (
              <span className="task-detail-url" title={task.url}>
                <strong>URL</strong> {task.url}
              </span>
            )}
            {task.sourceRef && (
              <span title={task.sourceRef}>
                <strong>Ref</strong> <span className="mono">{task.sourceRef}</span>
              </span>
            )}
          </div>

          {events.length > 0 && (
            <>
              <div className="task-detail-section">Lifecycle</div>
              <div className="activity-list task-detail-events">
                {events.map((e) => {
                  const f = formatEvent(e);
                  return (
                    <div key={f.id} className={`activity-row tone-${f.tone}`}>
                      <span className={`activity-source source-chip ${f.source}`}>
                        {f.source}
                      </span>
                      <div className="activity-body">
                        <div className="activity-message">{f.message}</div>
                        {f.detail && <div className="activity-detail">{f.detail}</div>}
                      </div>
                      <span className="activity-time">{relTime(f.ts)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="task-detail-footer">
          <span>
            {saving
              ? 'Saving…'
              : savedAt
                ? `Saved ${relTime(savedAt)} ago`
                : dirty
                  ? 'Unsaved changes'
                  : 'No changes'}
          </span>
          <div className="footer-spacer" />
          <kbd>⌘</kbd>
          <kbd>↵</kbd>
          <span>save</span>
        </div>
      </div>
    </div>
  );
}
