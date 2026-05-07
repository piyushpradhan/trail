import type { ActivityEvent } from '@shared/types';

export type EventTone = 'info' | 'ok' | 'warn' | 'error';

export interface FormattedEvent {
  id: string;
  ts: number;
  taskId: string | null;
  source: string;
  tone: EventTone;
  message: string;
  detail?: string;
}

interface PartialPayload {
  [key: string]: unknown;
}

function p(e: ActivityEvent): PartialPayload {
  return (e.payload && typeof e.payload === 'object' ? (e.payload as PartialPayload) : {});
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function formatEvent(e: ActivityEvent): FormattedEvent {
  const payload = p(e);
  const base = {
    id: e.id,
    ts: e.ts,
    taskId: e.taskId,
  };

  // collector.<name>.run
  const runMatch = /^collector\.([^.]+)\.run$/.exec(e.type);
  if (runMatch) {
    const source = runMatch[1]!;
    const created = num(payload['created']) ?? 0;
    const processed = num(payload['processed']) ?? num(payload['commands']) ?? num(payload['sources']);
    const detailParts: string[] = [];
    if (processed !== undefined) detailParts.push(`${processed} scanned`);
    if (Array.isArray(payload['discovered'])) {
      detailParts.push(`${(payload['discovered'] as unknown[]).length} sources`);
    }
    return {
      ...base,
      source,
      tone: created > 0 ? 'ok' : 'info',
      message: created > 0 ? `${source}: ${created} new task${created === 1 ? '' : 's'}` : `${source}: synced`,
      detail: detailParts.join(' · ') || undefined,
    };
  }

  // collector.<name>.error
  const errMatch = /^collector\.([^.]+)\.error$/.exec(e.type);
  if (errMatch) {
    return {
      ...base,
      source: errMatch[1]!,
      tone: 'error',
      message: `${errMatch[1]} error`,
      detail: str(payload['message']),
    };
  }

  // collector.<name>.skipped
  const skipMatch = /^collector\.([^.]+)\.skipped$/.exec(e.type);
  if (skipMatch) {
    return {
      ...base,
      source: skipMatch[1]!,
      tone: 'warn',
      message: `${skipMatch[1]} skipped`,
      detail: str(payload['reason']),
    };
  }

  // github / linear status_change
  if (e.type === 'github.status_change' || e.type === 'linear.status_change') {
    const source = e.type.split('.')[0]!;
    const ref = str(payload['ref']);
    return {
      ...base,
      source,
      tone: payload['to'] === 'done' ? 'ok' : payload['to'] === 'blocked' ? 'warn' : 'info',
      message: `${ref ?? source} → ${payload['to']}`,
      detail: payload['from'] ? `from ${payload['from']}` : undefined,
    };
  }

  // shell.session_start / end
  if (e.type === 'shell.session_start') {
    const repo = str(payload['repo']);
    const branch = str(payload['branch']);
    const cwd = str(payload['cwd']);
    return {
      ...base,
      source: 'shell',
      tone: 'info',
      message: repo
        ? `Shell opened in ${repo}${branch ? `@${branch}` : ''}`
        : cwd
          ? `Shell opened in ${cwd.split(/[\\/]/).slice(-2).join('/')}`
          : 'Shell opened',
      detail: str(payload['shell']),
    };
  }
  if (e.type === 'shell.session_end') {
    return {
      ...base,
      source: 'shell',
      tone: 'info',
      message: 'Shell closed',
      detail: payload['exitCode'] !== null ? `exit ${payload['exitCode']}` : undefined,
    };
  }

  // reconciler events
  if (e.type === 'reconciler.run') {
    const c = num(payload['created']) ?? 0;
    const m = num(payload['merged']) ?? 0;
    const s = num(payload['skipped']) ?? 0;
    return {
      ...base,
      source: 'reconciler',
      tone: c > 0 || m > 0 ? 'ok' : 'info',
      message: `Reconciler: ${c} created · ${m} merged · ${s} skipped`,
    };
  }
  if (e.type === 'reconciler.merged') {
    return {
      ...base,
      source: 'reconciler',
      tone: 'info',
      message: 'Reconciler merged event into existing task',
      detail: str(payload['reason']),
    };
  }
  if (e.type === 'reconciler.error' || e.type === 'reconciler.parse_error') {
    return {
      ...base,
      source: 'reconciler',
      tone: 'error',
      message: 'Reconciler error',
      detail: str(payload['message']),
    };
  }

  // task lifecycle
  if (e.type === 'task.created') {
    return { ...base, source: str(payload['source']) ?? 'task', tone: 'ok', message: 'Task created' };
  }
  if (e.type === 'task.status') {
    return {
      ...base,
      source: 'task',
      tone: payload['status'] === 'done' ? 'ok' : 'info',
      message: `Status → ${payload['status']}`,
    };
  }

  // nudge
  if (e.type === 'nudge.eod' || e.type === 'nudge.morning') {
    return {
      ...base,
      source: 'nudge',
      tone: 'info',
      message: e.type === 'nudge.eod' ? 'EOD nudge sent' : 'Morning brief sent',
      detail: payload['open'] ? `${payload['open']} open` : undefined,
    };
  }

  // hookServer
  if (e.type === 'hookServer.started') {
    return {
      ...base,
      source: 'hook',
      tone: 'ok',
      message: 'Shell-hook server started',
      detail: payload['port'] ? `port ${payload['port']}` : undefined,
    };
  }
  if (e.type === 'hookServer.error') {
    return {
      ...base,
      source: 'hook',
      tone: 'error',
      message: 'Hook server error',
      detail: str(payload['message']),
    };
  }

  // collector.terminal.activity / pane / prompt — keep terse
  if (e.type === 'collector.terminal.activity') {
    return {
      ...base,
      source: 'terminal',
      tone: 'info',
      message: `${str(payload['source']) ?? 'shell'}: ${num(payload['commands']) ?? 0} cmds`,
      detail: payload['todos'] ? `${payload['todos']} todos extracted` : undefined,
    };
  }
  if (e.type === 'collector.terminal.pane') {
    return {
      ...base,
      source: 'tmux',
      tone: 'info',
      message: `Pane ${payload['session'] ?? '?'}:${payload['window'] ?? '?'}.${payload['pane'] ?? '?'}`,
      detail: str(payload['cmd']),
    };
  }
  if (/\.prompt$/.test(e.type)) {
    const src = e.type.split('.')[1] ?? 'ai';
    return {
      ...base,
      source: src,
      tone: payload['isTask'] ? 'ok' : 'info',
      message: payload['isTask'] ? `${src}: prompt → task` : `${src}: prompt seen`,
      detail: str(payload['reason']),
    };
  }

  // fallback
  return {
    ...base,
    source: e.type.split('.')[0] ?? 'event',
    tone: 'info',
    message: e.type,
  };
}

export function relTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
