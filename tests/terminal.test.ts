import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseZshExtended,
  TERMINAL_TODO_RE,
  readSinceOffset,
  diagnoseTerminal,
} from '../src/main/collectors/terminal.js';

describe('parseZshExtended', () => {
  it('parses extended history format with timestamp', () => {
    const r = parseZshExtended(': 1700000000:0;echo hello world');
    expect(r.cmd).toBe('echo hello world');
    expect(r.ts).toBe(1700000000_000);
  });

  it('handles command containing semicolons', () => {
    const r = parseZshExtended(': 1700000000:0;cd foo; ls -la; cat /etc/passwd');
    expect(r.cmd).toBe('cd foo; ls -la; cat /etc/passwd');
  });

  it('returns raw line when not extended format', () => {
    const r = parseZshExtended('plain command');
    expect(r.cmd).toBe('plain command');
    expect(r.ts).toBeNull();
  });

  it('handles empty cmd portion', () => {
    const r = parseZshExtended(': 1700000000:0;');
    expect(r.cmd).toBe('');
    expect(r.ts).toBe(1700000000_000);
  });
});

describe('TERMINAL_TODO_RE', () => {
  const test = (line: string) => {
    const m = TERMINAL_TODO_RE.exec(line);
    return m ? { marker: m[1], body: m[2] } : null;
  };

  it('matches # TODO:', () => {
    expect(test('# TODO: implement retry logic')?.body).toBe('implement retry logic');
  });

  it('matches // FIXME', () => {
    expect(test('// FIXME memory leak in worker')?.marker?.toUpperCase()).toBe('FIXME');
  });

  it('matches FOLLOWUP and FOLLOW UP and FOLLOW-UP variants', () => {
    expect(test('# FOLLOWUP: ask about deploy date')).not.toBeNull();
    expect(test('# FOLLOW-UP: ask about deploy date')).not.toBeNull();
    expect(test('-- FOLLOW UP: ask about deploy date')).not.toBeNull();
  });

  it('matches with optional dash separator', () => {
    expect(test('# TODO - check this')?.body).toBe('check this');
  });

  it('does not match without comment prefix', () => {
    expect(test('TODO: nope')).toBeNull();
  });

  it('case-insensitive on marker', () => {
    expect(test('# todo: lowercase')?.body).toBe('lowercase');
  });
});

describe('readSinceOffset', () => {
  it('returns empty + same offset when file unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trail-rs-'));
    const f = join(dir, 'h');
    writeFileSync(f, 'one\ntwo\n');
    const first = readSinceOffset(f, 0);
    expect(first.text).toBe('one\ntwo\n');
    expect(first.nextOffset).toBe(8);
    const second = readSinceOffset(f, first.nextOffset);
    expect(second.text).toBe('');
    expect(second.nextOffset).toBe(8);
  });

  it('reads only new bytes when file appended', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trail-rs-'));
    const f = join(dir, 'h');
    writeFileSync(f, 'a\n');
    const first = readSinceOffset(f, 0);
    appendFileSync(f, 'b\nc\n');
    const second = readSinceOffset(f, first.nextOffset);
    expect(second.text).toBe('b\nc\n');
  });

  it('handles file truncation (offset > size)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trail-rs-'));
    const f = join(dir, 'h');
    writeFileSync(f, 'longer content here\n');
    // pretend cursor was advanced beyond current size (file rotated)
    const r = readSinceOffset(f, 999);
    expect(r.text).toBe('');
    expect(r.nextOffset).toBe(20);
  });

  it('handles empty file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trail-rs-'));
    const f = join(dir, 'h');
    writeFileSync(f, '');
    const r = readSinceOffset(f, 0);
    expect(r.text).toBe('');
    expect(r.nextOffset).toBe(0);
  });

  it('throws on missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trail-rs-'));
    const f = join(dir, 'missing');
    expect(() => readSinceOffset(f, 0)).toThrow();
  });

  it('preserves utf-8 content including non-ASCII', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trail-rs-'));
    const f = join(dir, 'h');
    writeFileSync(f, '# TODO: handle 日本語 path 🦊\n');
    const r = readSinceOffset(f, 0);
    expect(r.text).toContain('日本語');
    expect(r.text).toContain('🦊');
  });
});

describe('diagnoseTerminal', () => {
  it('returns object with expected shape', () => {
    const d = diagnoseTerminal();
    expect(d).toHaveProperty('platform');
    expect(d).toHaveProperty('discovered');
    expect(d).toHaveProperty('attempted');
    expect(Array.isArray(d.discovered)).toBe(true);
    expect(Array.isArray(d.attempted)).toBe(true);
  });

  it('platform matches os.platform()', () => {
    expect(diagnoseTerminal().platform).toBe(process.platform);
  });
});
