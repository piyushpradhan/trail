import React from 'react';
import type { Task, TaskStatus } from '@shared/types';
import { useStore } from '../store';
import { ExternalIcon, SnoozeIcon, TrashIcon } from '../icons';

const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  todo: 'in_progress',
  in_progress: 'done',
  blocked: 'todo',
  done: 'todo',
  snoozed: 'todo',
};

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

interface Props {
  task: Task;
}

export function TaskItem({ task }: Props): JSX.Element {
  const setStatus = useStore((s) => s.setStatus);
  const snooze = useStore((s) => s.snooze);
  const remove = useStore((s) => s.remove);
  const open = useStore((s) => s.open);

  const sixHours = 6 * 3600_000;
  const stalled =
    (task.status === 'todo' || task.status === 'in_progress') &&
    task.lastTouchedAt < Date.now() - sixHours;

  return (
    <div className={`task ${task.status === 'done' ? 'done' : ''}`}>
      {stalled && <span className="stalled-dot" title="Stalled" />}

      <button
        className={`status-pill ${task.status}`}
        title={task.status}
        onClick={() => setStatus(task.id, STATUS_CYCLE[task.status])}
      />

      <div className="task-body" onDoubleClick={() => open(task.id)}>
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          <span className={`source-chip ${task.source}`}>{task.source}</span>
          <span>·</span>
          <span>{relTime(task.lastTouchedAt)}</span>
        </div>
      </div>

      <div className="task-actions">
        {task.url && (
          <button className="icon-btn" title="Open" onClick={() => open(task.id)}>
            <ExternalIcon />
          </button>
        )}
        <button className="icon-btn" title="Snooze 4h" onClick={() => snooze(task.id, 4)}>
          <SnoozeIcon />
        </button>
        <button className="icon-btn" title="Delete" onClick={() => remove(task.id)}>
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}
