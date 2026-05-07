import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tasksRepo, eventsRepo } from './db.js';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';

export const DEFAULT_HOOK_PORT = 47123;
export const HOOK_PORT =
  parseInt(process.env['TRAIL_HOOK_PORT'] ?? '', 10) || DEFAULT_HOOK_PORT;

let activePort = HOOK_PORT;
export function getActivePort(): number {
  return activePort;
}

interface SessionStartBody {
  shell?: string;
  cwd?: string;
  pid?: number;
  host?: string;
  user?: string;
  title?: string;
  branch?: string;
  repo?: string;
}

const activeSessions = new Map<string, { taskId: string; startedAt: number }>();

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

export function deriveTitle(body: SessionStartBody): string {
  const repo = body.repo;
  const branch = body.branch;
  const cwd = body.cwd?.replace(/\\/g, '/').split('/').slice(-2).join('/');
  if (repo && branch) return `Working on ${repo}@${branch}`;
  if (repo) return `Working on ${repo}`;
  if (cwd) return `Shell session in ${cwd}`;
  return body.shell ? `${body.shell} session` : 'Shell session';
}

export function sessionKey(body: SessionStartBody): string {
  return `${body.host ?? 'local'}:${body.shell ?? 'shell'}:${body.pid ?? 'unknown'}:${body.cwd ?? ''}`;
}

async function handleStart(body: SessionStartBody): Promise<{ taskId: string; key: string }> {
  const key = sessionKey(body);
  const now = Date.now();
  const existing = activeSessions.get(key);
  if (existing) {
    tasksRepo.update(existing.taskId, { lastTouchedAt: now });
    return { taskId: existing.taskId, key };
  }

  const ref = `${key}:${now}`;
  const task = tasksRepo.upsertBySourceRef({
    title: body.title ?? deriveTitle(body),
    source: 'tmux',
    sourceRef: ref,
    tags: [
      'shell-session',
      body.shell ?? 'shell',
      ...(body.repo ? [body.repo] : []),
      ...(body.branch ? [`branch:${body.branch}`] : []),
    ],
    notes: [
      body.cwd && `cwd: ${body.cwd}`,
      body.repo && `repo: ${body.repo}`,
      body.branch && `branch: ${body.branch}`,
      body.host && `host: ${body.host}`,
      body.user && `user: ${body.user}`,
    ].filter(Boolean).join('\n') || null,
  });
  tasksRepo.update(task.id, { status: 'in_progress' });

  activeSessions.set(key, { taskId: task.id, startedAt: now });
  eventsRepo.log('shell.session_start', { key, ...body }, task.id);
  return { taskId: task.id, key };
}

async function handleEnd(body: SessionStartBody & { exitCode?: number }): Promise<void> {
  const key = sessionKey(body);
  const sess = activeSessions.get(key);
  if (!sess) return;
  activeSessions.delete(key);
  // Don't auto-mark done — user may still be tracking work that started in that session
  eventsRepo.log('shell.session_end', { key, exitCode: body.exitCode ?? null }, sess.taskId);
}

let server: ReturnType<typeof createServer> | null = null;

export function startHookServer(onChange: () => void, port: number = HOOK_PORT): Promise<number> {
  if (server) return Promise.resolve(activePort);
  activePort = port;
  server = createServer((req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});

    if (req.url === '/health' && req.method === 'GET') {
      return send(res, 200, { ok: true, version: app.getVersion() });
    }

    if (req.method === 'POST' && req.url === '/session/start') {
      void readBody(req)
        .then(async (raw) => {
          const body = (raw ? JSON.parse(raw) : {}) as SessionStartBody;
          const r = await handleStart(body);
          onChange();
          send(res, 200, r);
        })
        .catch((err: Error) => send(res, 400, { error: err.message }));
      return;
    }

    if (req.method === 'POST' && req.url === '/session/end') {
      void readBody(req)
        .then(async (raw) => {
          const body = (raw ? JSON.parse(raw) : {}) as SessionStartBody & { exitCode?: number };
          await handleEnd(body);
          onChange();
          send(res, 200, { ok: true });
        })
        .catch((err: Error) => send(res, 400, { error: err.message }));
      return;
    }

    if (req.method === 'POST' && req.url === '/task') {
      void readBody(req)
        .then(async (raw) => {
          const body = JSON.parse(raw) as { title: string; tags?: string[]; url?: string };
          if (!body.title) throw new Error('title required');
          const t = tasksRepo.create({
            title: body.title,
            source: 'manual',
            tags: body.tags ?? ['shell-hook'],
            url: body.url ?? null,
          });
          onChange();
          send(res, 200, { id: t.id });
        })
        .catch((err: Error) => send(res, 400, { error: err.message }));
      return;
    }

    send(res, 404, { error: 'not found' });
  });

  return new Promise<number>((resolve, reject) => {
    server!.once('error', (err: NodeJS.ErrnoException) => {
      eventsRepo.log('hookServer.error', { message: err.message, code: err.code, port });
      // Surface bind errors so tests / launchers know the server didn't actually start
      reject(err);
    });
    server!.listen(port, '127.0.0.1', () => {
      // Re-attach a non-rejecting error handler for runtime errors after listen succeeded
      server!.removeAllListeners('error');
      server!.on('error', (err) => {
        eventsRepo.log('hookServer.error', { message: err.message });
      });
      const addr = server!.address();
      if (addr && typeof addr === 'object') activePort = addr.port;
      eventsRepo.log('hookServer.started', { port: activePort });
      resolve(activePort);
    });
  });
}

export function stopHookServer(): void {
  server?.close();
  server = null;
}
