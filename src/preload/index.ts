import { contextBridge, ipcRenderer } from 'electron';
import type { TrailAPI } from '@shared/types';

const api: TrailAPI = {
  tasks: {
    list: (filter) => ipcRenderer.invoke('tasks:list', filter),
    create: (input) => ipcRenderer.invoke('tasks:create', input),
    update: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
    setStatus: (id, status) => ipcRenderer.invoke('tasks:setStatus', id, status),
    snooze: (id, until) => ipcRenderer.invoke('tasks:snooze', id, until),
    remove: (id) => ipcRenderer.invoke('tasks:remove', id),
    touch: (id) => ipcRenderer.invoke('tasks:touch', id),
  },
  collectors: {
    runAll: () => ipcRenderer.invoke('collectors:runAll'),
    runOne: (name) => ipcRenderer.invoke('collectors:runOne', name),
  },
  reconciler: {
    run: () => ipcRenderer.invoke('reconciler:run'),
  },
  events: {
    recent: (limit) => ipcRenderer.invoke('events:recent', limit),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setApiKey: (key) => ipcRenderer.invoke('settings:setApiKey', key),
    clearApiKey: () => ipcRenderer.invoke('settings:clearApiKey'),
    setReconcilerEnabled: (enabled) => ipcRenderer.invoke('settings:setReconcilerEnabled', enabled),
    setGithubToken: (token) => ipcRenderer.invoke('settings:setGithubToken', token),
    clearGithubToken: () => ipcRenderer.invoke('settings:clearGithubToken'),
    setGithubEnabled: (enabled) => ipcRenderer.invoke('settings:setGithubEnabled', enabled),
    setGithubRepoFilters: (include, exclude) =>
      ipcRenderer.invoke('settings:setGithubRepoFilters', include, exclude),
    diagnoseGithub: () => ipcRenderer.invoke('settings:diagnoseGithub'),
    setLinearToken: (token) => ipcRenderer.invoke('settings:setLinearToken', token),
    clearLinearToken: () => ipcRenderer.invoke('settings:clearLinearToken'),
    setLinearEnabled: (enabled) => ipcRenderer.invoke('settings:setLinearEnabled', enabled),
    setLinearTeamFilter: (teams) => ipcRenderer.invoke('settings:setLinearTeamFilter', teams),
    diagnoseLinear: () => ipcRenderer.invoke('settings:diagnoseLinear'),
    diagnoseTerminal: () => ipcRenderer.invoke('settings:diagnoseTerminal'),
    getHookInfo: () => ipcRenderer.invoke('settings:getHookInfo'),
    installShellHook: (shell) => ipcRenderer.invoke('settings:installShellHook', shell),
    uninstallShellHook: (shell, profilePath) =>
      ipcRenderer.invoke('settings:uninstallShellHook', shell, profilePath),
    suggestedShell: () => ipcRenderer.invoke('settings:suggestedShell'),
    setOnboardingComplete: (v) => ipcRenderer.invoke('settings:setOnboardingComplete', v),
  },
  updater: {
    status: () => ipcRenderer.invoke('updater:status'),
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (cb) => {
      const handler = (_e: unknown, s: unknown) => cb(s as Parameters<typeof cb>[0]);
      ipcRenderer.on('updater:status', handler);
      return () => ipcRenderer.removeListener('updater:status', handler);
    },
  },
  app: {
    quit: () => ipcRenderer.send('app:quit'),
    openExternal: (url) => ipcRenderer.send('app:openExternal', url),
    version: () => ipcRenderer.invoke('app:version'),
  },
};

contextBridge.exposeInMainWorld('trail', api);

contextBridge.exposeInMainWorld('trailEvents', {
  onChange: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('tasks:changed', handler);
    return () => ipcRenderer.removeListener('tasks:changed', handler);
  },
  onSync: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('trigger:sync', handler);
    return () => ipcRenderer.removeListener('trigger:sync', handler);
  },
});
