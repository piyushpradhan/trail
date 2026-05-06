import Store from 'electron-store';
import { safeStorage } from 'electron';

interface Schema {
  apiKeyEncrypted?: string;
  reconcilerEnabled: boolean;
  reconcilerIntervalMinutes: number;
  reconcilerMaxEventsPerRun: number;
  githubTokenEncrypted?: string;
  githubRepoInclude: string[]; // substring match against owner/name
  githubRepoExclude: string[];
  githubEnabled: boolean;
}

const store = new Store<Schema>({
  defaults: {
    reconcilerEnabled: true,
    reconcilerIntervalMinutes: 30,
    reconcilerMaxEventsPerRun: 30,
    githubRepoInclude: [],
    githubRepoExclude: [],
    githubEnabled: true,
  },
});

export const settings = {
  hasApiKey(): boolean {
    return !!store.get('apiKeyEncrypted');
  },

  getApiKey(): string | null {
    const enc = store.get('apiKeyEncrypted');
    if (!enc) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null;
    }
  },

  setApiKey(plain: string): void {
    if (!plain) {
      store.delete('apiKeyEncrypted');
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage unavailable on this system');
    }
    const enc = safeStorage.encryptString(plain).toString('base64');
    store.set('apiKeyEncrypted', enc);
  },

  clearApiKey(): void {
    store.delete('apiKeyEncrypted');
  },

  getReconciler() {
    return {
      enabled: store.get('reconcilerEnabled'),
      intervalMinutes: store.get('reconcilerIntervalMinutes'),
      maxEventsPerRun: store.get('reconcilerMaxEventsPerRun'),
    };
  },

  setReconcilerEnabled(v: boolean): void {
    store.set('reconcilerEnabled', v);
  },

  // GitHub
  hasGithubToken(): boolean {
    return !!store.get('githubTokenEncrypted');
  },

  getGithubToken(): string | null {
    const enc = store.get('githubTokenEncrypted');
    if (!enc) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null;
    }
  },

  setGithubToken(token: string): void {
    if (!token) {
      store.delete('githubTokenEncrypted');
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage unavailable on this system');
    }
    const enc = safeStorage.encryptString(token).toString('base64');
    store.set('githubTokenEncrypted', enc);
  },

  clearGithubToken(): void {
    store.delete('githubTokenEncrypted');
  },

  getGithub(): {
    enabled: boolean;
    hasToken: boolean;
    repoInclude: string[];
    repoExclude: string[];
  } {
    return {
      enabled: store.get('githubEnabled'),
      hasToken: this.hasGithubToken(),
      repoInclude: store.get('githubRepoInclude'),
      repoExclude: store.get('githubRepoExclude'),
    };
  },

  setGithubEnabled(v: boolean): void {
    store.set('githubEnabled', v);
  },

  setGithubRepoFilters(include: string[], exclude: string[]): void {
    store.set('githubRepoInclude', include);
    store.set('githubRepoExclude', exclude);
  },
};
