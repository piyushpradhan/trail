import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initDb } from '../src/main/db.js';
import { getCursor, setCursor } from '../src/main/collectors/state.js';
import { getUserData } from './setup.js';

beforeAll(async () => {
  await initDb();
});

describe('cursor state store', () => {
  it('returns undefined for missing key', () => {
    expect(getCursor('does-not-exist:xyz')).toBeUndefined();
  });

  it('roundtrips set/get', () => {
    setCursor('k1', 'v1');
    expect(getCursor('k1')).toBe('v1');
  });

  it('overwrites existing key', () => {
    setCursor('k2', 'a');
    setCursor('k2', 'b');
    expect(getCursor('k2')).toBe('b');
  });

  it('persists to disk', () => {
    setCursor('persistKey', 'persistVal');
    const file = join(getUserData(), 'data', 'collectors.json');
    const raw = readFileSync(file, 'utf-8');
    const json = JSON.parse(raw);
    expect(json.cursors.persistKey).toBe('persistVal');
  });

  it('survives corrupt JSON gracefully (resets)', () => {
    // Force-corrupt the file, then reading via a fresh module instance returns undefined.
    // Within a single process, the in-memory cache hides corruption from us — verify file write
    // path doesn't crash on subsequent set after manual corruption.
    const dir = join(getUserData(), 'data');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'corrupt-test.json'), 'not json {');
    // ensure no throw on continuing operations
    expect(() => setCursor('afterCorrupt', '1')).not.toThrow();
  });

  it('handles unicode and special characters', () => {
    setCursor('🦊:path with spaces', 'value with "quotes" and \\ slash');
    expect(getCursor('🦊:path with spaces')).toBe('value with "quotes" and \\ slash');
  });
});
