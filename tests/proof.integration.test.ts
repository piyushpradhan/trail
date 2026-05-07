/**
 * Proof harness — runs each collector against the user's REAL data
 * and dumps what it produced.
 *
 * Skipped unless RUN_PROOF=1 is set, so CI stays hermetic.
 *
 * Run:  RUN_PROOF=1 npx vitest run tests/proof.integration.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, getDb, tasksRepo, eventsRepo } from '../src/main/db.js';
import { runClaudeCollector } from '../src/main/collectors/claude.js';
import { runCodexCollector } from '../src/main/collectors/codex.js';
import { runOpencodeCollector } from '../src/main/collectors/opencode.js';
import { runTerminalCollector } from '../src/main/collectors/terminal.js';
import { runTmuxCollector } from '../src/main/collectors/tmux.js';
import { startHookServer, stopHookServer, HOOK_PORT } from '../src/main/hookServer.js';
import { diagnoseTerminal } from '../src/main/collectors/terminal.js';

const ENABLED = process.env.RUN_PROOF === '1';
const d = ENABLED ? describe : describe.skip;

function dumpEvents(label: string): void {
  const events = eventsRepo.recent(50);
  const byType = new Map<string, number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  console.log(`\n=== ${label} :: events (${events.length} total) ===`);
  for (const [type, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${type}`);
  }
  // Show last 3 raw payloads for spot-check
  console.log(`  --- sample (newest 3) ---`);
  for (const e of events.slice(0, 3)) {
    const payload = JSON.stringify(e.payload).slice(0, 200);
    console.log(`  [${e.type}] ${payload}`);
  }
}

function dumpTasks(label: string, source?: string): void {
  const all = source ? tasksRepo.list().filter((t) => t.source === source) : tasksRepo.list();
  console.log(`\n=== ${label} :: tasks (${all.length} ${source ?? 'all'}) ===`);
  for (const t of all.slice(0, 8)) {
    console.log(`  [${t.source}/${t.status}] ${t.title.slice(0, 90)}`);
    if (t.tags.length) console.log(`           tags: ${t.tags.join(', ')}`);
  }
  if (all.length > 8) console.log(`  ... and ${all.length - 8} more`);
}

beforeAll(async () => {
  await initDb();
});

d('PROOF — collectors run against real user data', () => {
  it('Claude Code session collector reads ~/.claude/projects/*.jsonl', async () => {
    getDb().run('DELETE FROM tasks');
    getDb().run('DELETE FROM events');
    // Deep scan: bypass 48h freshness gate so we can prove extraction even
    // when the user's last Claude session is older than 2 days.
    const r = await runClaudeCollector({ maxAgeHours: 17520 });
    console.log('\nClaude collector returned:', r);
    dumpEvents('Claude');
    dumpTasks('Claude', 'claude');
    expect(eventsRepo.recent(1).length).toBeGreaterThan(0);
  });

  it('Codex collector handles missing ~/.codex gracefully', async () => {
    getDb().run('DELETE FROM tasks');
    getDb().run('DELETE FROM events');
    const r = await runCodexCollector();
    console.log('\nCodex collector returned:', r);
    expect(r.created).toBe(0);
  });

  it('OpenCode collector reads ~/.local/share/opencode/storage', async () => {
    getDb().run('DELETE FROM tasks');
    getDb().run('DELETE FROM events');
    const r = await runOpencodeCollector({ maxAgeHours: 17520 });
    console.log('\nOpenCode collector returned:', r);
    dumpEvents('OpenCode');
    dumpTasks('OpenCode', 'opencode');
  });

  it('Terminal collector tails real shell histories', async () => {
    getDb().run('DELETE FROM tasks');
    getDb().run('DELETE FROM events');
    const diag = diagnoseTerminal();
    console.log('\nTerminal diagnostic:');
    for (const d of diag.discovered) {
      console.log(`  [${d.name}] ${(d.sizeBytes / 1024).toFixed(1)}KB  ${d.path}`);
    }
    if (diag.discovered.length === 0) {
      console.log('  no shells discovered. attempted:');
      for (const a of diag.attempted) console.log(`  × ${a.name}: ${a.path}`);
    }
    const r = await runTerminalCollector();
    console.log('Terminal collector returned:', r);
    dumpEvents('Terminal');
    dumpTasks('Terminal (TODOs from shell history)', 'tmux');
    expect(diag.discovered.length).toBeGreaterThan(0);
  });

  it('tmux collector queries live tmux server', async () => {
    getDb().run('DELETE FROM tasks');
    getDb().run('DELETE FROM events');
    const r = await runTmuxCollector();
    console.log('\ntmux collector returned:', r);
    dumpEvents('tmux');
  });
});

d('PROOF — shell-hook HTTP endpoint creates session tasks', () => {
  beforeAll(() => {
    startHookServer(() => undefined);
  });

  it('opening a new shell pings /session/start and a task appears', async () => {
    getDb().run('DELETE FROM tasks');
    getDb().run('DELETE FROM events');

    // Simulate two shell windows opening + one closing
    const start = (body: object) =>
      fetch(`http://127.0.0.1:${HOOK_PORT}/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());

    await new Promise((r) => setTimeout(r, 50));

    const a = await start({
      shell: 'pwsh',
      cwd: 'D:\\projects\\trail',
      pid: 1001,
      host: 'demo',
      user: 'piyush',
      repo: 'trail',
      branch: 'main',
    });
    const b = await start({
      shell: 'bash',
      cwd: '/home/piyush/code/foo',
      pid: 2002,
      host: 'demo',
      user: 'piyush',
      repo: 'foo',
      branch: 'feature/x',
    });
    // Same key as A → idempotent dedup
    const aDup = await start({
      shell: 'pwsh',
      cwd: 'D:\\projects\\trail',
      pid: 1001,
      host: 'demo',
      user: 'piyush',
    });

    console.log('\nshell hook responses:');
    console.log('  A:', a);
    console.log('  B:', b);
    console.log('  A (dup):', aDup);

    expect(a.taskId).toBeTruthy();
    expect(b.taskId).toBeTruthy();
    expect(aDup.taskId).toBe(a.taskId); // dedupe proof

    dumpTasks('Shell hook tasks', 'tmux');
    dumpEvents('Hook server');

    stopHookServer();
  });
});
