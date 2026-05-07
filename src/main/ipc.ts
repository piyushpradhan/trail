import { ipcMain, shell, app } from 'electron';
import { tasksRepo, eventsRepo } from './db.js';
import { collectors, runAllCollectors, type CollectorName } from './collectors/index.js';
import { runReconciler } from './reconciler.js';
import { diagnoseGithub } from './collectors/github.js';
import { diagnoseLinear } from './collectors/linear.js';
import { diagnoseSlack } from './collectors/slack.js';
import { diagnoseTerminal } from './collectors/terminal.js';
import { getActivePort } from './hookServer.js';
import { installShellHook, uninstallShellHook, suggestedShell, type InstallShell } from './installHook.js';
import { checkForUpdatesManual, getUpdateStatus, quitAndInstall } from './updater.js';
import { join } from 'node:path';
import { settings } from './settings.js';
import type { Task, TaskInput, TaskStatus } from '@shared/types';

export function registerIpc(onChange: () => void): void {
  const wrap = <Args extends unknown[], R>(fn: (...a: Args) => R) =>
    async (_e: unknown, ...args: Args): Promise<R> => fn(...args);

  ipcMain.handle('tasks:list', wrap((filter?: { status?: TaskStatus[] }) => tasksRepo.list(filter)));

  ipcMain.handle('tasks:create', wrap((input: TaskInput) => {
    const t = tasksRepo.create(input);
    eventsRepo.log('task.created', { id: t.id, source: t.source });
    onChange();
    return t;
  }));

  ipcMain.handle('tasks:update', wrap((id: string, patch: Partial<Task>) => {
    const t = tasksRepo.update(id, patch);
    onChange();
    return t;
  }));

  ipcMain.handle('tasks:setStatus', wrap((id: string, status: TaskStatus) => {
    const t = tasksRepo.update(id, { status, lastTouchedAt: Date.now() });
    eventsRepo.log('task.status', { id, status }, id);
    onChange();
    return t;
  }));

  ipcMain.handle('tasks:snooze', wrap((id: string, until: number) => {
    const t = tasksRepo.update(id, { snoozedUntil: until, status: 'snoozed' });
    onChange();
    return t;
  }));

  ipcMain.handle('tasks:remove', wrap((id: string) => {
    tasksRepo.remove(id);
    onChange();
  }));

  ipcMain.handle('tasks:touch', wrap((id: string) => {
    tasksRepo.update(id, { lastTouchedAt: Date.now() });
    onChange();
  }));

  ipcMain.handle('collectors:runAll', async () => {
    const r = await runAllCollectors();
    onChange();
    return r;
  });

  ipcMain.handle('collectors:runOne', async (_e, name: CollectorName) => {
    const fn = collectors[name];
    if (!fn) throw new Error(`Unknown collector: ${name}`);
    const r = await fn();
    onChange();
    return r;
  });

  ipcMain.handle('events:recent', wrap((limit?: number) =>
    eventsRepo.recent(Math.min(Math.max(limit ?? 100, 1), 500)).map((e) => ({
      id: e.id,
      taskId: e.taskId,
      type: e.type,
      payload: e.payload,
      ts: e.ts,
    })),
  ));

  ipcMain.handle('reconciler:run', async () => {
    const r = await runReconciler();
    onChange();
    return r;
  });

  ipcMain.handle('settings:get', () => ({
    hasApiKey: settings.hasApiKey(),
    reconciler: settings.getReconciler(),
    github: settings.getGithub(),
    linear: settings.getLinear(),
    slack: settings.getSlack(),
    onboardingComplete: settings.isOnboardingComplete(),
  }));

  ipcMain.handle('settings:setApiKey', wrap((key: string) => settings.setApiKey(key)));
  ipcMain.handle('settings:clearApiKey', wrap(() => settings.clearApiKey()));
  ipcMain.handle('settings:setReconcilerEnabled', wrap((enabled: boolean) =>
    settings.setReconcilerEnabled(enabled),
  ));

  ipcMain.handle('settings:setGithubToken', wrap((token: string) => settings.setGithubToken(token)));
  ipcMain.handle('settings:clearGithubToken', wrap(() => settings.clearGithubToken()));
  ipcMain.handle('settings:setGithubEnabled', wrap((enabled: boolean) =>
    settings.setGithubEnabled(enabled),
  ));
  ipcMain.handle('settings:setGithubRepoFilters', wrap((include: string[], exclude: string[]) =>
    settings.setGithubRepoFilters(include, exclude),
  ));
  ipcMain.handle('settings:diagnoseGithub', () => diagnoseGithub());

  ipcMain.handle('settings:setLinearToken', wrap((token: string) => settings.setLinearToken(token)));
  ipcMain.handle('settings:clearLinearToken', wrap(() => settings.clearLinearToken()));
  ipcMain.handle('settings:setLinearEnabled', wrap((enabled: boolean) =>
    settings.setLinearEnabled(enabled),
  ));
  ipcMain.handle('settings:setLinearTeamFilter', wrap((teams: string[]) =>
    settings.setLinearTeamFilter(teams),
  ));
  ipcMain.handle('settings:diagnoseLinear', () => diagnoseLinear());

  ipcMain.handle('settings:setSlackToken', wrap((token: string) => settings.setSlackToken(token)));
  ipcMain.handle('settings:clearSlackToken', wrap(() => settings.clearSlackToken()));
  ipcMain.handle('settings:setSlackEnabled', wrap((enabled: boolean) => settings.setSlackEnabled(enabled)));
  ipcMain.handle('settings:setSlackOptions', wrap((opts: Parameters<typeof settings.setSlackOptions>[0]) =>
    settings.setSlackOptions(opts),
  ));
  ipcMain.handle('settings:diagnoseSlack', () => diagnoseSlack());
  ipcMain.handle('settings:diagnoseTerminal', () => diagnoseTerminal());

  ipcMain.handle('settings:installShellHook', wrap((shell: InstallShell) => installShellHook(shell)));
  ipcMain.handle('settings:uninstallShellHook', wrap((shell: InstallShell, profilePath: string) =>
    uninstallShellHook(shell, profilePath),
  ));
  ipcMain.handle('settings:suggestedShell', () => suggestedShell());
  ipcMain.handle('settings:setOnboardingComplete', wrap((v: boolean) =>
    settings.setOnboardingComplete(v),
  ));

  ipcMain.handle('settings:getHookInfo', () => {
    const base = app.isPackaged
      ? join(process.resourcesPath, 'hooks')
      : join(app.getAppPath(), 'resources', 'hooks');
    return {
      port: getActivePort(),
      psScriptPath: join(base, 'trail-hook.ps1'),
      shScriptPath: join(base, 'trail-hook.sh'),
    };
  });

  ipcMain.handle('updater:status', () => getUpdateStatus());
  ipcMain.handle('updater:check', () => checkForUpdatesManual());
  ipcMain.handle('updater:install', () => quitAndInstall());
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
}
