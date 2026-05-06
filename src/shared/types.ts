export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'snoozed';

export type TaskSource =
  | 'manual'
  | 'github'
  | 'slack'
  | 'tmux'
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'pi';

export interface Task {
  id: string;
  title: string;
  source: TaskSource;
  sourceRef: string | null;
  status: TaskStatus;
  url: string | null;
  tags: string[];
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  dueAt: number | null;
  snoozedUntil: number | null;
  lastTouchedAt: number;
}

export interface TaskInput {
  title: string;
  source?: TaskSource;
  sourceRef?: string | null;
  url?: string | null;
  tags?: string[];
  notes?: string | null;
  dueAt?: number | null;
}

export interface ReconcileResult {
  attempted: number;
  created: number;
  merged: number;
  skipped: number;
  reason?: string;
}

export interface GithubStatus {
  ok: boolean;
  mode: 'pat' | 'gh-cli' | 'unconfigured';
  user?: string;
  message?: string;
  scopes?: string;
}

export interface TerminalDiagnostic {
  platform: string;
  discovered: Array<{ name: string; path: string; sizeBytes: number; mtime: number }>;
  attempted: Array<{ name: string; path: string; reason: string }>;
}

export interface SettingsSnapshot {
  hasApiKey: boolean;
  reconciler: {
    enabled: boolean;
    intervalMinutes: number;
    maxEventsPerRun: number;
  };
  github: {
    enabled: boolean;
    hasToken: boolean;
    repoInclude: string[];
    repoExclude: string[];
  };
}

export interface TrailAPI {
  tasks: {
    list: (filter?: { status?: TaskStatus[] }) => Promise<Task[]>;
    create: (input: TaskInput) => Promise<Task>;
    update: (id: string, patch: Partial<Task>) => Promise<Task>;
    setStatus: (id: string, status: TaskStatus) => Promise<Task>;
    snooze: (id: string, until: number) => Promise<Task>;
    remove: (id: string) => Promise<void>;
    touch: (id: string) => Promise<void>;
  };
  collectors: {
    runAll: () => Promise<{ ran: string[]; created: number }>;
    runOne: (name: string) => Promise<{ created: number }>;
  };
  reconciler: {
    run: () => Promise<ReconcileResult>;
  };
  settings: {
    get: () => Promise<SettingsSnapshot>;
    setApiKey: (key: string) => Promise<void>;
    clearApiKey: () => Promise<void>;
    setReconcilerEnabled: (enabled: boolean) => Promise<void>;
    setGithubToken: (token: string) => Promise<void>;
    clearGithubToken: () => Promise<void>;
    setGithubEnabled: (enabled: boolean) => Promise<void>;
    setGithubRepoFilters: (include: string[], exclude: string[]) => Promise<void>;
    diagnoseGithub: () => Promise<GithubStatus>;
    diagnoseTerminal: () => Promise<TerminalDiagnostic>;
    getHookInfo: () => Promise<{ port: number; psScriptPath: string; shScriptPath: string }>;
  };
  app: {
    quit: () => void;
    openExternal: (url: string) => void;
  };
}

declare global {
  interface Window {
    trail: TrailAPI;
  }
}
