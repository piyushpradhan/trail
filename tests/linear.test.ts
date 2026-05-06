import { describe, it, expect } from 'vitest';
import { statusFromLinearState, teamPassesFilter } from '../src/main/collectors/linear.js';

describe('statusFromLinearState', () => {
  it('completed → done', () => {
    expect(statusFromLinearState('completed')).toBe('done');
  });

  it('canceled → blocked', () => {
    expect(statusFromLinearState('canceled')).toBe('blocked');
  });

  it('started → in_progress', () => {
    expect(statusFromLinearState('started')).toBe('in_progress');
  });

  it('triage / backlog / unstarted → todo', () => {
    expect(statusFromLinearState('triage')).toBe('todo');
    expect(statusFromLinearState('backlog')).toBe('todo');
    expect(statusFromLinearState('unstarted')).toBe('todo');
  });

  it('unknown state defaults to todo (defensive)', () => {
    // forces typecheck but tests fallthrough
    expect(statusFromLinearState('weird-future-state' as any)).toBe('todo');
  });
});

describe('teamPassesFilter', () => {
  it('empty filter → match all', () => {
    expect(teamPassesFilter('ENG', [])).toBe(true);
  });

  it('exact key match (case-insensitive)', () => {
    expect(teamPassesFilter('ENG', ['eng'])).toBe(true);
    expect(teamPassesFilter('eng', ['ENG'])).toBe(true);
  });

  it('substring match', () => {
    expect(teamPassesFilter('PLATFORM-ENG', ['ENG'])).toBe(true);
    expect(teamPassesFilter('DESIGN', ['ENG'])).toBe(false);
  });

  it('multi-team OR semantics', () => {
    expect(teamPassesFilter('INFRA', ['ENG', 'INFRA'])).toBe(true);
    expect(teamPassesFilter('SALES', ['ENG', 'INFRA'])).toBe(false);
  });
});
