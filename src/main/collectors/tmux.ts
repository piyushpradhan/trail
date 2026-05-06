import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tasksRepo, eventsRepo } from '../db.js';
import { scorePrompt } from './heuristics.js';

const exec = promisify(execFile);

const LIST_FORMAT = '#{session_name}\t#{window_index}\t#{pane_index}\t#{pane_id}\t#{pane_current_command}\t#{pane_current_path}';

interface Pane {
  session: string;
  window: string;
  pane: string;
  paneId: string;
  cmd: string;
  cwd: string;
}

const TODO_RE = /^\s*(?:#|\/\/|--)?\s*(TODO|TASK|FIXME|FOLLOW[- ]?UP)\b\s*[:\-]?\s*(.+?)\s*$/i;

async function tmux(args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('tmux', args, { maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return '';
    throw err;
  }
}

async function listPanes(): Promise<Pane[]> {
  const out = await tmux(['list-panes', '-a', '-F', LIST_FORMAT]);
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [session, window, pane, paneId, cmd, cwd] = line.split('\t');
      return {
        session: session ?? '',
        window: window ?? '',
        pane: pane ?? '',
        paneId: paneId ?? '',
        cmd: cmd ?? '',
        cwd: cwd ?? '',
      };
    });
}

async function captureRecent(paneId: string): Promise<string> {
  return tmux(['capture-pane', '-pJ', '-S', '-200', '-t', paneId]);
}

export async function runTmuxCollector(): Promise<{ created: number }> {
  let panes: Pane[];
  try {
    panes = await listPanes();
  } catch (err) {
    eventsRepo.log('collector.tmux.error', { message: (err as Error).message });
    return { created: 0 };
  }

  if (panes.length === 0) {
    eventsRepo.log('collector.tmux.run', { panes: 0, created: 0 });
    return { created: 0 };
  }

  let created = 0;
  for (const p of panes) {
    eventsRepo.log('collector.tmux.pane', {
      session: p.session,
      window: p.window,
      pane: p.pane,
      cmd: p.cmd,
      cwd: p.cwd,
    });

    let buffer: string;
    try {
      buffer = await captureRecent(p.paneId);
    } catch {
      continue;
    }

    const lines = buffer.split('\n');
    for (const line of lines) {
      const m = TODO_RE.exec(line);
      if (!m) continue;
      const body = m[2]?.trim();
      if (!body) continue;

      const score = scorePrompt(body);
      const title = score.isTask ? score.title : body.slice(0, 119);
      const ref = `${p.session}:${p.window}:${p.pane}:${body.slice(0, 80)}`;

      if (tasksRepo.bySourceRef('tmux', ref)) continue;

      tasksRepo.upsertBySourceRef({
        title,
        source: 'tmux',
        sourceRef: ref,
        tags: ['tmux', p.session],
        notes: `Pane ${p.session}:${p.window}.${p.pane} (${p.cwd})`,
      });
      created++;
    }
  }

  eventsRepo.log('collector.tmux.run', { panes: panes.length, created });
  return { created };
}
