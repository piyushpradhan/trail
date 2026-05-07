import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb } from '../src/main/db.js';
import {
  installToProfile,
  removeFromProfile,
  buildBlock,
  MARKER_BEGIN,
  MARKER_END,
} from '../src/main/installHook.js';

let dir: string;

beforeAll(async () => {
  await initDb();
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trail-prof-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('buildBlock', () => {
  it('powershell uses dot-source', () => {
    const block = buildBlock('C:\\path\\hook.ps1', 'powershell');
    expect(block).toContain(MARKER_BEGIN);
    expect(block).toContain(MARKER_END);
    expect(block).toContain('. "C:\\path\\hook.ps1"');
  });

  it('bash/zsh use source', () => {
    const block = buildBlock('/path/hook.sh', 'bash');
    expect(block).toContain('source "/path/hook.sh"');
    expect(buildBlock('/path/hook.sh', 'zsh')).toContain('source "/path/hook.sh"');
  });
});

describe('installToProfile — fresh profile', () => {
  it('creates the file when missing and writes block with markers', () => {
    const profile = join(dir, '.bashrc');
    const r = installToProfile(profile, '/path/hook.sh', 'bash');
    expect(r.ok).toBe(true);
    expect(r.alreadyInstalled).toBe(false);
    const text = readFileSync(profile, 'utf-8');
    expect(text).toContain(MARKER_BEGIN);
    expect(text).toContain(MARKER_END);
    expect(text).toContain('source "/path/hook.sh"');
  });

  it('handles deeply nested profile path (creates parent dirs)', () => {
    const profile = join(dir, 'Documents', 'WindowsPowerShell', 'profile.ps1');
    const r = installToProfile(profile, 'C:\\hook.ps1', 'powershell');
    expect(r.ok).toBe(true);
    expect(existsSync(profile)).toBe(true);
  });
});

describe('installToProfile — existing profile', () => {
  it('appends without truncating prior content', () => {
    const profile = join(dir, '.bashrc');
    writeFileSync(profile, 'export FOO=bar\nalias ll="ls -la"\n');
    const r = installToProfile(profile, '/x/hook.sh', 'bash');
    expect(r.ok).toBe(true);
    const text = readFileSync(profile, 'utf-8');
    expect(text).toContain('export FOO=bar');
    expect(text).toContain('alias ll=');
    expect(text).toContain(MARKER_BEGIN);
  });

  it('handles existing file without trailing newline', () => {
    const profile = join(dir, '.bashrc');
    writeFileSync(profile, 'no newline at end');
    const r = installToProfile(profile, '/x/hook.sh', 'bash');
    expect(r.ok).toBe(true);
    const text = readFileSync(profile, 'utf-8');
    expect(text).toContain('no newline at end\n');
    expect(text).toContain(MARKER_BEGIN);
  });

  it('creates a backup before modifying', () => {
    const profile = join(dir, '.bashrc');
    writeFileSync(profile, 'original\n');
    installToProfile(profile, '/x/hook.sh', 'bash');
    expect(existsSync(profile + '.trail.bak')).toBe(true);
    expect(readFileSync(profile + '.trail.bak', 'utf-8')).toBe('original\n');
  });
});

describe('installToProfile — idempotence', () => {
  it('second install detects existing markers and returns alreadyInstalled', () => {
    const profile = join(dir, '.bashrc');
    installToProfile(profile, '/x/hook.sh', 'bash');
    const r2 = installToProfile(profile, '/x/hook.sh', 'bash');
    expect(r2.ok).toBe(true);
    expect(r2.alreadyInstalled).toBe(true);
    const text = readFileSync(profile, 'utf-8');
    const matches = text.match(/# >>> trail shell hook >>>/g);
    expect(matches).toHaveLength(1);
  });
});

describe('removeFromProfile', () => {
  it('strips trail block, preserves other content', () => {
    const profile = join(dir, '.bashrc');
    writeFileSync(profile, 'export FOO=1\n');
    installToProfile(profile, '/x/hook.sh', 'bash');
    const r = removeFromProfile(profile, 'bash');
    expect(r.ok).toBe(true);
    const text = readFileSync(profile, 'utf-8');
    expect(text).toContain('export FOO=1');
    expect(text).not.toContain(MARKER_BEGIN);
    expect(text).not.toContain('source ');
  });

  it('no-op when block already absent', () => {
    const profile = join(dir, '.bashrc');
    writeFileSync(profile, 'export FOO=1\n');
    const r = removeFromProfile(profile, 'bash');
    expect(r.ok).toBe(true);
    expect(r.alreadyInstalled).toBe(false);
    expect(r.message).toBe('Not installed');
  });

  it('no-op when profile does not exist', () => {
    const r = removeFromProfile(join(dir, 'nope'), 'bash');
    expect(r.ok).toBe(true);
  });

  it('removing then reinstalling leaves clean single block', () => {
    const profile = join(dir, '.bashrc');
    installToProfile(profile, '/x/hook.sh', 'bash');
    removeFromProfile(profile, 'bash');
    installToProfile(profile, '/x/hook.sh', 'bash');
    const text = readFileSync(profile, 'utf-8');
    const matches = text.match(/# >>> trail shell hook >>>/g);
    expect(matches).toHaveLength(1);
  });
});
