import { vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test run gets its own userData dir
const userData = mkdtempSync(join(tmpdir(), 'trail-test-'));

const safeStore = new Map<string, string>();

vi.mock('electron', () => {
  const fakeApp = {
    getPath: (name: string) => {
      if (name === 'userData') return userData;
      return tmpdir();
    },
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getVersion: () => '0.0.0-test',
    on: vi.fn(),
    quit: vi.fn(),
  };

  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('enc:' + s),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf-8');
      if (!s.startsWith('enc:')) throw new Error('not encrypted');
      return s.slice(4);
    },
  };

  class Notification {
    static isSupported() {
      return false;
    }
    constructor(public opts: unknown) {}
    show() {}
    on() {}
  }

  return {
    app: fakeApp,
    safeStorage,
    Notification,
    shell: { openExternal: vi.fn() },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({}) }) },
    BrowserWindow: class {},
    Tray: class {},
    Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    screen: {},
    globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
  };
});

// Stub electron-store to in-memory map (avoids file IO collisions across tests)
vi.mock('electron-store', () => {
  return {
    default: class Store<T extends Record<string, unknown>> {
      private data: Record<string, unknown>;
      constructor(opts: { defaults?: T } = {}) {
        this.data = { ...(opts.defaults ?? {}) };
      }
      get<K extends string>(key: K): unknown {
        return this.data[key];
      }
      set(key: string, value: unknown): void {
        this.data[key] = value;
      }
      delete(key: string): void {
        delete this.data[key];
      }
      clear(): void {
        this.data = {};
      }
    },
  };
});

export function getUserData(): string {
  return userData;
}

export { safeStore };
