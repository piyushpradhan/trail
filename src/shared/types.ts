export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'snoozed';

export type TaskSource =
  | 'manual'
  | 'github'
  | 'linear'
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

export interface ActivityEvent {
  id: string;
  taskId: string | null;
  type: string;
  payload: unknown;
  ts: number;
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; info: { version: string; releaseDate?: string; releaseNotes?: string } }
  | { kind: 'not-available'; currentVersion: string }
  | { kind: 'downloading'; percent: number; transferred: number; total: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

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

export interface HookInstallResult {
  ok: boolean;
  shell: 'powershell' | 'bash' | 'zsh';
  profilePath?: string;
  scriptPath?: string;
  alreadyInstalled?: boolean;
  message?: string;
}

export interface SlackStatus {
  ok: boolean;
  user?: string;
  team?: string;
  userId?: string;
  message?: string;
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
  linear: {
    enabled: boolean;
    hasToken: boolean;
    teamFilter: string[];
  };
  slack: {
    enabled: boolean;
    hasToken: boolean;
    includeMentions: boolean;
    includeDms: boolean;
    channelExclude: string[];
  };
  onboardingComplete: boolean;
}

export interface LinearStatus {
  ok: boolean;
  user?: string;
  email?: string;
  message?: string;
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
  events: {
    recent: (limit?: number) => Promise<ActivityEvent[]>;
  };
  updater: {
    status: () => Promise<UpdateStatus>;
    check: () => Promise<UpdateStatus>;
    install: () => Promise<void>;
    onStatus: (cb: (s: UpdateStatus) => void) => () => void;
  };
  app: {
    quit: () => void;
    openExternal: (url: string) => void;
    version: () => Promise<string>;
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
    setLinearToken: (token: string) => Promise<void>;
    clearLinearToken: () => Promise<void>;
    setLinearEnabled: (enabled: boolean) => Promise<void>;
    setLinearTeamFilter: (teams: string[]) => Promise<void>;
    diagnoseLinear: () => Promise<LinearStatus>;
    setSlackToken: (token: string) => Promise<void>;
    clearSlackToken: () => Promise<void>;
    setSlackEnabled: (enabled: boolean) => Promise<void>;
    setSlackOptions: (opts: { includeMentions?: boolean; includeDms?: boolean; channelExclude?: string[] }) => Promise<void>;
    diagnoseSlack: () => Promise<SlackStatus>;
    diagnoseTerminal: () => Promise<TerminalDiagnostic>;
    getHookInfo: () => Promise<{ port: number; psScriptPath: string; shScriptPath: string }>;
    installShellHook: (shell: 'powershell' | 'bash' | 'zsh') => Promise<HookInstallResult>;
    uninstallShellHook: (
      shell: 'powershell' | 'bash' | 'zsh',
      profilePath: string,
    ) => Promise<HookInstallResult>;
    suggestedShell: () => Promise<'powershell' | 'bash' | 'zsh'>;
    setOnboardingComplete: (v: boolean) => Promise<void>;
  };
}

declare global {
  interface Window {
    trail: TrailAPI;
  }
}
