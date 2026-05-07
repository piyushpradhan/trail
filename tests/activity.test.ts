import { describe, it, expect } from 'vitest';
import { formatEvent, relTime } from '../src/renderer/activity.js';
import type { ActivityEvent } from '../src/shared/types.js';

const e = (type: string, payload: unknown, ts = Date.now()): ActivityEvent => ({
  id: 'e1',
  taskId: null,
  type,
  payload,
  ts,
});

describe('formatEvent — collector runs', () => {
  it('formats github run with new tasks as ok tone', () => {
    const r = formatEvent(e('collector.github.run', { created: 3, reviews: 5, mine: 2 }));
    expect(r.source).toBe('github');
    expect(r.tone).toBe('ok');
    expect(r.message).toBe('github: 3 new tasks');
  });

  it('formats run with no new as info tone', () => {
    const r = formatEvent(e('collector.linear.run', { created: 0, processed: 12 }));
    expect(r.tone).toBe('info');
    expect(r.message).toBe('linear: synced');
    expect(r.detail).toContain('12');
  });

  it('singular vs plural', () => {
    expect(formatEvent(e('collector.x.run', { created: 1 })).message).toContain('1 new task');
    expect(formatEvent(e('collector.x.run', { created: 5 })).message).toContain('5 new tasks');
  });

  it('errors are red', () => {
    const r = formatEvent(e('collector.github.error', { message: 'bad token' }));
    expect(r.tone).toBe('error');
    expect(r.detail).toBe('bad token');
  });

  it('skipped is warn tone', () => {
    const r = formatEvent(e('collector.linear.skipped', { reason: 'no_token' }));
    expect(r.tone).toBe('warn');
    expect(r.detail).toBe('no_token');
  });
});

describe('formatEvent — status changes', () => {
  it('github merged → ok', () => {
    const r = formatEvent(
      e('github.status_change', { ref: 'foo/bar#42', from: 'in_progress', to: 'done' }),
    );
    expect(r.tone).toBe('ok');
    expect(r.message).toBe('foo/bar#42 → done');
    expect(r.detail).toBe('from in_progress');
  });

  it('linear blocked → warn', () => {
    const r = formatEvent(e('linear.status_change', { ref: 'ENG-1', from: 'started', to: 'blocked' }));
    expect(r.tone).toBe('warn');
    expect(r.source).toBe('linear');
  });

  it('falls back without ref', () => {
    const r = formatEvent(e('github.status_change', { from: 'todo', to: 'in_progress' }));
    expect(r.message).toContain('→ in_progress');
  });
});

describe('formatEvent — shell sessions', () => {
  it('start with repo + branch', () => {
    const r = formatEvent(
      e('shell.session_start', { repo: 'trail', branch: 'main', shell: 'pwsh' }),
    );
    expect(r.message).toBe('Shell opened in trail@main');
    expect(r.detail).toBe('pwsh');
  });

  it('start cwd-only fallback', () => {
    const r = formatEvent(e('shell.session_start', { cwd: 'C:\\projects\\trail' }));
    expect(r.message).toBe('Shell opened in projects/trail');
  });

  it('end shows exit code if non-null', () => {
    const r = formatEvent(e('shell.session_end', { exitCode: 0 }));
    expect(r.message).toBe('Shell closed');
    expect(r.detail).toBe('exit 0');
  });
});

describe('formatEvent — reconciler', () => {
  it('summarizes counts', () => {
    const r = formatEvent(e('reconciler.run', { created: 2, merged: 1, skipped: 3 }));
    expect(r.tone).toBe('ok');
    expect(r.message).toContain('2 created');
    expect(r.message).toContain('1 merged');
    expect(r.message).toContain('3 skipped');
  });

  it('zero counts → info', () => {
    expect(formatEvent(e('reconciler.run', { created: 0, merged: 0, skipped: 5 })).tone).toBe('info');
  });

  it('parse_error → error tone', () => {
    expect(formatEvent(e('reconciler.parse_error', { message: 'bad json' })).tone).toBe('error');
  });
});

describe('formatEvent — fallback', () => {
  it('unknown type renders type as message', () => {
    const r = formatEvent(e('weird.unknown.event', {}));
    expect(r.message).toBe('weird.unknown.event');
    expect(r.source).toBe('weird');
    expect(r.tone).toBe('info');
  });

  it('handles non-object payload safely', () => {
    expect(() => formatEvent(e('a.b.c', null))).not.toThrow();
    expect(() => formatEvent(e('a.b.c', 'string-payload'))).not.toThrow();
    expect(() => formatEvent(e('a.b.c', 42))).not.toThrow();
  });
});

describe('formatEvent — prompt events', () => {
  it('marks isTask=true as ok', () => {
    const r = formatEvent(e('collector.claude.prompt', { isTask: true, reason: 'imperative' }));
    expect(r.tone).toBe('ok');
    expect(r.message).toContain('claude: prompt → task');
  });

  it('isTask=false as info', () => {
    const r = formatEvent(e('collector.codex.prompt', { isTask: false, reason: 'too short' }));
    expect(r.tone).toBe('info');
    expect(r.detail).toBe('too short');
  });
});

describe('relTime', () => {
  const now = 1_700_000_000_000;
  it('< 1 minute = now', () => {
    expect(relTime(now - 30_000, now)).toBe('now');
  });
  it('minutes', () => {
    expect(relTime(now - 5 * 60_000, now)).toBe('5m');
    expect(relTime(now - 59 * 60_000, now)).toBe('59m');
  });
  it('hours', () => {
    expect(relTime(now - 3 * 3600_000, now)).toBe('3h');
    expect(relTime(now - 23 * 3600_000, now)).toBe('23h');
  });
  it('days', () => {
    expect(relTime(now - 2 * 24 * 3600_000, now)).toBe('2d');
  });
});
