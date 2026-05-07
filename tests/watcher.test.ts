import { describe, it, expect, vi } from 'vitest';
import { makeDebouncer } from '../src/main/watcher.js';

interface FakeTimers {
  now: () => number;
  schedule: (cb: () => void, ms: number) => unknown;
  unschedule: (t: unknown) => void;
  advance: (ms: number) => Promise<void>;
}

function fakeTimers(): FakeTimers {
  let current = 0;
  type Timer = { fireAt: number; cb: () => void };
  const timers = new Map<number, Timer>();
  let nextId = 1;

  return {
    now: () => current,
    schedule: (cb, ms) => {
      const id = nextId++;
      timers.set(id, { fireAt: current + ms, cb });
      return id;
    },
    unschedule: (t) => {
      timers.delete(t as number);
    },
    advance: async (ms) => {
      const target = current + ms;
      while (true) {
        let nextEntry: { id: number; t: Timer } | null = null;
        for (const [id, t] of timers) {
          if (t.fireAt <= target && (!nextEntry || t.fireAt < nextEntry.t.fireAt)) {
            nextEntry = { id, t };
          }
        }
        if (!nextEntry) break;
        timers.delete(nextEntry.id);
        current = nextEntry.t.fireAt;
        nextEntry.t.cb();
        // let microtasks drain
        await Promise.resolve();
        await Promise.resolve();
      }
      current = target;
    },
  };
}

describe('makeDebouncer', () => {
  it('calls task once after wait period of quiet', async () => {
    const ft = fakeTimers();
    const task = vi.fn().mockResolvedValue(undefined);
    const d = makeDebouncer(task, 1000, ft.now, ft.schedule, ft.unschedule);
    d.trigger();
    await ft.advance(500);
    expect(task).not.toHaveBeenCalled();
    await ft.advance(500);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid triggers into a single call', async () => {
    const ft = fakeTimers();
    const task = vi.fn().mockResolvedValue(undefined);
    const d = makeDebouncer(task, 1000, ft.now, ft.schedule, ft.unschedule);
    for (let i = 0; i < 5; i++) {
      await ft.advance(100);
      d.trigger();
    }
    await ft.advance(900);
    expect(task).not.toHaveBeenCalled();
    await ft.advance(100);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('arms a trailing call when triggered during in-flight task', async () => {
    const ft = fakeTimers();
    let resolveTask: () => void = () => undefined;
    const task = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveTask = resolve;
        }),
    );
    const d = makeDebouncer(task, 100, ft.now, ft.schedule, ft.unschedule);
    d.trigger();
    await ft.advance(100); // first task fires
    expect(task).toHaveBeenCalledTimes(1);

    // While first task is in-flight, trigger again
    d.trigger();
    await ft.advance(50);
    // First task still running, no second call yet
    expect(task).toHaveBeenCalledTimes(1);

    // First task finishes
    resolveTask();
    await Promise.resolve();
    await Promise.resolve();

    // Trailing call should be armed; advance through wait
    await ft.advance(100);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('cancel prevents pending task from firing', async () => {
    const ft = fakeTimers();
    const task = vi.fn().mockResolvedValue(undefined);
    const d = makeDebouncer(task, 1000, ft.now, ft.schedule, ft.unschedule);
    d.trigger();
    d.cancel();
    await ft.advance(2000);
    expect(task).not.toHaveBeenCalled();
  });

  it('flush runs immediately', async () => {
    const ft = fakeTimers();
    const task = vi.fn().mockResolvedValue(undefined);
    const d = makeDebouncer(task, 1000, ft.now, ft.schedule, ft.unschedule);
    d.trigger();
    await d.flush();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('handles task that throws without breaking subsequent triggers', async () => {
    const ft = fakeTimers();
    let calls = 0;
    const task = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
    });
    const d = makeDebouncer(task, 100, ft.now, ft.schedule, ft.unschedule);
    d.trigger();
    await ft.advance(100);
    // First call threw — should not leave debouncer locked
    expect(task).toHaveBeenCalledTimes(1);

    d.trigger();
    await ft.advance(100);
    expect(task).toHaveBeenCalledTimes(2);
  });
});
