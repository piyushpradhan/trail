import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { initDb, getDb, tasksRepo } from '../src/main/db.js';
import { startHookServer, stopHookServer, sessionKey, deriveTitle, HOOK_PORT } from '../src/main/hookServer.js';

beforeAll(async () => {
  await initDb();
  startHookServer(() => undefined);
  // tiny wait to let listen complete
  await new Promise((r) => setTimeout(r, 50));
});

afterAll(() => {
  stopHookServer();
});

beforeEach(() => {
  getDb().run('DELETE FROM tasks');
  getDb().run('DELETE FROM events');
});

const URL = `http://127.0.0.1:${HOOK_PORT}`;

describe('sessionKey', () => {
  it('combines host shell pid cwd', () => {
    expect(sessionKey({ host: 'h1', shell: 'pwsh', pid: 1234, cwd: '/x' })).toBe(
      'h1:pwsh:1234:/x',
    );
  });

  it('uses fallbacks for missing fields', () => {
    expect(sessionKey({})).toBe('local:shell:unknown:');
  });

  it('different cwd → different key', () => {
    const k1 = sessionKey({ host: 'h', shell: 's', pid: 1, cwd: '/a' });
    const k2 = sessionKey({ host: 'h', shell: 's', pid: 1, cwd: '/b' });
    expect(k1).not.toBe(k2);
  });
});

describe('deriveTitle', () => {
  it('uses repo+branch when both present', () => {
    expect(deriveTitle({ repo: 'trail', branch: 'main' })).toBe('Working on trail@main');
  });

  it('repo only', () => {
    expect(deriveTitle({ repo: 'trail' })).toBe('Working on trail');
  });

  it('cwd-only fallback uses last 2 path segments', () => {
    expect(deriveTitle({ cwd: 'D:\\projects\\foo\\bar' })).toBe('Shell session in foo/bar');
  });

  it('shell-only fallback', () => {
    expect(deriveTitle({ shell: 'bash' })).toBe('bash session');
  });

  it('empty body → generic title', () => {
    expect(deriveTitle({})).toBe('Shell session');
  });
});

describe('HTTP endpoints', () => {
  it('GET /health returns ok', async () => {
    const res = await fetch(`${URL}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('POST /session/start creates task with in_progress status', async () => {
    const res = await fetch(`${URL}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shell: 'pwsh',
        cwd: 'C:\\projects\\foo',
        pid: 9999,
        host: 'host1',
        user: 'u',
        repo: 'foo',
        branch: 'main',
      }),
    });
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.taskId).toBeTruthy();

    const t = tasksRepo.byId(r.taskId);
    expect(t).not.toBeNull();
    expect(t!.status).toBe('in_progress');
    expect(t!.title).toBe('Working on foo@main');
    expect(t!.tags).toContain('shell-session');
    expect(t!.tags).toContain('foo');
  });

  it('POST /session/start with same key returns same taskId (idempotent)', async () => {
    const body = JSON.stringify({
      shell: 'pwsh', cwd: '/x', pid: 1, host: 'h', user: 'u',
    });
    const r1 = await (await fetch(`${URL}/session/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })).json();
    const r2 = await (await fetch(`${URL}/session/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })).json();
    expect(r1.taskId).toBe(r2.taskId);
    expect(tasksRepo.list()).toHaveLength(1);
  });

  it('POST /task creates a manual task', async () => {
    const res = await fetch(`${URL}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'from shell', tags: ['adhoc'] }),
    });
    expect(res.status).toBe(200);
    const r = await res.json();
    const t = tasksRepo.byId(r.id);
    expect(t!.title).toBe('from shell');
    expect(t!.tags).toContain('adhoc');
    expect(t!.source).toBe('manual');
  });

  it('POST /task without title returns 400', async () => {
    const res = await fetch(`${URL}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await fetch(`${URL}/session/start`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('unknown route returns 404', async () => {
    const res = await fetch(`${URL}/nope`);
    expect(res.status).toBe(404);
  });

  it('malformed JSON body returns 400', async () => {
    const res = await fetch(`${URL}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('POST /session/end is no-op for unknown session (does not throw)', async () => {
    const res = await fetch(`${URL}/session/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shell: 'pwsh', pid: 99999, host: 'unseen' }),
    });
    expect(res.status).toBe(200);
  });
});
