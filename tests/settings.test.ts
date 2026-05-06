import { describe, it, expect, beforeEach } from 'vitest';
import { settings } from '../src/main/settings.js';

describe('settings — Anthropic API key', () => {
  beforeEach(() => {
    settings.clearApiKey();
  });

  it('defaults: no key', () => {
    expect(settings.hasApiKey()).toBe(false);
    expect(settings.getApiKey()).toBeNull();
  });

  it('set + get roundtrip', () => {
    settings.setApiKey('sk-ant-test-123');
    expect(settings.hasApiKey()).toBe(true);
    expect(settings.getApiKey()).toBe('sk-ant-test-123');
  });

  it('setApiKey with empty string clears', () => {
    settings.setApiKey('x');
    settings.setApiKey('');
    expect(settings.hasApiKey()).toBe(false);
  });

  it('clearApiKey removes', () => {
    settings.setApiKey('y');
    settings.clearApiKey();
    expect(settings.hasApiKey()).toBe(false);
  });
});

describe('settings — GitHub', () => {
  beforeEach(() => {
    settings.clearGithubToken();
  });

  it('defaults', () => {
    const cfg = settings.getGithub();
    expect(cfg.enabled).toBe(true);
    expect(cfg.hasToken).toBe(false);
    expect(cfg.repoInclude).toEqual([]);
    expect(cfg.repoExclude).toEqual([]);
  });

  it('persists token + filters', () => {
    settings.setGithubToken('ghp_xyz');
    settings.setGithubRepoFilters(['acme/'], ['archive']);
    settings.setGithubEnabled(false);
    const cfg = settings.getGithub();
    expect(cfg.hasToken).toBe(true);
    expect(cfg.enabled).toBe(false);
    expect(cfg.repoInclude).toEqual(['acme/']);
    expect(cfg.repoExclude).toEqual(['archive']);
    expect(settings.getGithubToken()).toBe('ghp_xyz');
  });

  it('empty token clears storage', () => {
    settings.setGithubToken('x');
    settings.setGithubToken('');
    expect(settings.hasGithubToken()).toBe(false);
  });
});

describe('settings — Linear', () => {
  beforeEach(() => {
    settings.clearLinearToken();
  });

  it('defaults', () => {
    const cfg = settings.getLinear();
    expect(cfg.enabled).toBe(true);
    expect(cfg.hasToken).toBe(false);
    expect(cfg.teamFilter).toEqual([]);
  });

  it('persists token + team filter', () => {
    settings.setLinearToken('lin_api_xyz');
    settings.setLinearTeamFilter(['ENG', 'INFRA']);
    settings.setLinearEnabled(false);
    const cfg = settings.getLinear();
    expect(cfg.hasToken).toBe(true);
    expect(cfg.enabled).toBe(false);
    expect(cfg.teamFilter).toEqual(['ENG', 'INFRA']);
    expect(settings.getLinearToken()).toBe('lin_api_xyz');
  });

  it('empty token clears', () => {
    settings.setLinearToken('x');
    settings.setLinearToken('');
    expect(settings.hasLinearToken()).toBe(false);
  });
});

describe('settings — reconciler', () => {
  it('defaults are sensible', () => {
    const r = settings.getReconciler();
    expect(r.enabled).toBe(true);
    expect(r.intervalMinutes).toBeGreaterThan(0);
    expect(r.maxEventsPerRun).toBeGreaterThan(0);
  });

  it('can toggle enabled', () => {
    settings.setReconcilerEnabled(false);
    expect(settings.getReconciler().enabled).toBe(false);
    settings.setReconcilerEnabled(true);
    expect(settings.getReconciler().enabled).toBe(true);
  });
});
