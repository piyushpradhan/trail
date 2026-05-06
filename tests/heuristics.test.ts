import { describe, it, expect } from 'vitest';
import { scorePrompt, projectFromSlug } from '../src/main/collectors/heuristics.js';

describe('scorePrompt', () => {
  it('rejects when too short', () => {
    const r = scorePrompt('fix it');
    expect(r.isTask).toBe(false);
    expect(r.reason).toBe('too short');
  });

  it('accepts on TODO marker even mid-sentence', () => {
    const r = scorePrompt('I was thinking, TODO: write integration tests for the new module');
    expect(r.isTask).toBe(true);
    expect(r.reason).toBe('marker');
  });

  it('accepts FIXME / FOLLOWUP / FOLLOW UP / TASK markers', () => {
    for (const word of ['FIXME', 'FOLLOWUP', 'FOLLOW UP', 'TASK']) {
      const r = scorePrompt(`${word} make sure to handle the retry edge case here`);
      expect(r.isTask).toBe(true);
    }
  });

  it('rejects pure questions', () => {
    const r = scorePrompt('What is the difference between let and const?');
    expect(r.isTask).toBe(false);
    expect(r.reason).toBe('pure question');
  });

  it('accepts imperatives starting with verb', () => {
    const r = scorePrompt('Refactor the auth middleware to use the new token store');
    expect(r.isTask).toBe(true);
    expect(r.reason).toBe('imperative');
  });

  it('rejects when imperative-like but ambiguous', () => {
    const r = scorePrompt('I think this looks somewhat reasonable already maybe');
    expect(r.isTask).toBe(false);
    expect(r.reason).toBe('no signal');
  });

  it('truncates title at 120 chars', () => {
    const long = 'fix '.repeat(60);
    const r = scorePrompt(long);
    expect(r.title.length).toBeLessThanOrEqual(120);
  });

  it('uses first line/sentence for title', () => {
    const r = scorePrompt('fix the leak.\n\nAlso here is more context that should not appear');
    expect(r.title).toBe('fix the leak');
  });

  it('handles excessive whitespace and newlines without breaking', () => {
    const r = scorePrompt('   fix       the    \n\n leak   here   in    auth   ');
    expect(r.isTask).toBe(true);
  });

  it('rejects exactly at length boundary 19', () => {
    const r = scorePrompt('a'.repeat(19));
    expect(r.isTask).toBe(false);
  });

  it('processes at length 20+', () => {
    const r = scorePrompt('TODO: ' + 'a'.repeat(20));
    expect(r.isTask).toBe(true);
  });
});

describe('projectFromSlug', () => {
  it('returns last segment of dash path', () => {
    expect(projectFromSlug('C--Users-Piyush-projects-trail')).toBe('trail');
  });

  it('handles single-segment slug', () => {
    expect(projectFromSlug('foo')).toBe('foo');
  });

  it('handles empty slug', () => {
    expect(projectFromSlug('')).toBe('');
  });
});
