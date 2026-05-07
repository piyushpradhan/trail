import { app, BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { eventsRepo } from './db.js';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; info: { version: string; releaseDate?: string; releaseNotes?: string } }
  | { kind: 'not-available'; currentVersion: string }
  | { kind: 'downloading'; percent: number; transferred: number; total: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

let lastStatus: UpdateStatus = { kind: 'idle' };
let popoverRef: BrowserWindow | null = null;
let manualCheck = false;

function broadcast(status: UpdateStatus): void {
  lastStatus = status;
  popoverRef?.webContents.send('updater:status', status);
}

export function getUpdateStatus(): UpdateStatus {
  return lastStatus;
}

export function initUpdater(popover: BrowserWindow): void {
  popoverRef = popover;

  if (!app.isPackaged) {
    // Dev mode: don't auto-check (would 404 on local builds without an installed app version)
    eventsRepo.log('updater.skipped', { reason: 'dev_mode' });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => {
    broadcast({ kind: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    eventsRepo.log('updater.available', { version: info.version });
    broadcast({
      kind: 'available',
      info: {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      },
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    if (manualCheck) {
      broadcast({ kind: 'not-available', currentVersion: info.version });
    } else {
      lastStatus = { kind: 'idle' };
    }
    manualCheck = false;
  });

  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    broadcast({
      kind: 'downloading',
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    eventsRepo.log('updater.downloaded', { version: info.version });
    broadcast({ kind: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    eventsRepo.log('updater.error', { message: err.message });
    broadcast({ kind: 'error', message: err.message });
  });

  // First check 30s after launch, then every 4h
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 30_000);
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => undefined), 4 * 3600 * 1000);
}

export async function checkForUpdatesManual(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    const s: UpdateStatus = { kind: 'not-available', currentVersion: app.getVersion() };
    broadcast(s);
    return s;
  }
  manualCheck = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    broadcast({ kind: 'error', message: (err as Error).message });
  }
  return lastStatus;
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall(true, true);
}
