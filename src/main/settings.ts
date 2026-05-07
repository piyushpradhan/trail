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
  linearTokenEncrypted?: string;
  linearTeamFilter: string[]; // team key match (substring), empty = all teams
  linearEnabled: boolean;
  slackTokenEncrypted?: string;
  slackEnabled: boolean;
  slackIncludeMentions: boolean;
  slackIncludeDms: boolean;
  slackChannelExclude: string[]; // channel name substring filter
  onboardingComplete: boolean;
}

const store = new Store<Schema>({
  defaults: {
    reconcilerEnabled: true,
    reconcilerIntervalMinutes: 30,
    reconcilerMaxEventsPerRun: 30,
    githubRepoInclude: [],
    githubRepoExclude: [],
    githubEnabled: true,
    linearTeamFilter: [],
    linearEnabled: true,
    slackEnabled: true,
    slackIncludeMentions: true,
    slackIncludeDms: true,
    slackChannelExclude: [],
    onboardingComplete: false,
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

  // Linear
  hasLinearToken(): boolean {
    return !!store.get('linearTokenEncrypted');
  },

  getLinearToken(): string | null {
    const enc = store.get('linearTokenEncrypted');
    if (!enc) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null;
    }
  },

  setLinearToken(token: string): void {
    if (!token) {
      store.delete('linearTokenEncrypted');
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage unavailable on this system');
    }
    const enc = safeStorage.encryptString(token).toString('base64');
    store.set('linearTokenEncrypted', enc);
  },

  clearLinearToken(): void {
    store.delete('linearTokenEncrypted');
  },

  getLinear(): { enabled: boolean; hasToken: boolean; teamFilter: string[] } {
    return {
      enabled: store.get('linearEnabled'),
      hasToken: this.hasLinearToken(),
      teamFilter: store.get('linearTeamFilter'),
    };
  },

  setLinearEnabled(v: boolean): void {
    store.set('linearEnabled', v);
  },

  setLinearTeamFilter(teams: string[]): void {
    store.set('linearTeamFilter', teams);
  },

  // Slack
  hasSlackToken(): boolean {
    return !!store.get('slackTokenEncrypted');
  },

  getSlackToken(): string | null {
    const enc = store.get('slackTokenEncrypted');
    if (!enc) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null;
    }
  },

  setSlackToken(token: string): void {
    if (!token) {
      store.delete('slackTokenEncrypted');
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage unavailable on this system');
    }
    const enc = safeStorage.encryptString(token).toString('base64');
    store.set('slackTokenEncrypted', enc);
  },

  clearSlackToken(): void {
    store.delete('slackTokenEncrypted');
  },

  getSlack(): {
    enabled: boolean;
    hasToken: boolean;
    includeMentions: boolean;
    includeDms: boolean;
    channelExclude: string[];
  } {
    return {
      enabled: store.get('slackEnabled'),
      hasToken: this.hasSlackToken(),
      includeMentions: store.get('slackIncludeMentions'),
      includeDms: store.get('slackIncludeDms'),
      channelExclude: store.get('slackChannelExclude'),
    };
  },

  setSlackEnabled(v: boolean): void {
    store.set('slackEnabled', v);
  },

  setSlackOptions(opts: { includeMentions?: boolean; includeDms?: boolean; channelExclude?: string[] }): void {
    if (opts.includeMentions !== undefined) store.set('slackIncludeMentions', opts.includeMentions);
    if (opts.includeDms !== undefined) store.set('slackIncludeDms', opts.includeDms);
    if (opts.channelExclude !== undefined) store.set('slackChannelExclude', opts.channelExclude);
  },

  // Onboarding
  isOnboardingComplete(): boolean {
    return !!store.get('onboardingComplete');
  },

  setOnboardingComplete(v: boolean): void {
    store.set('onboardingComplete', v);
  },
};
