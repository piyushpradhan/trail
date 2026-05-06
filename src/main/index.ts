import { app, BrowserWindow, globalShortcut } from 'electron';
import { join } from 'node:path';
import { initDb, saveDbNow } from './db.js';
import { registerIpc } from './ipc.js';
import { TrayController } from './tray.js';
import { runAllCollectors } from './collectors/index.js';
import { runReconciler } from './reconciler.js';
import { settings } from './settings.js';
import { checkNudges } from './nudge.js';
import { startHookServer, stopHookServer } from './hookServer.js';

const isDev = !app.isPackaged;
const POPOVER_WIDTH = 380;
const POPOVER_HEIGHT = 540;
const TOGGLE_HOTKEY = 'CommandOrControl+Shift+Space';

let tray: TrayController;
let popover: BrowserWindow;

function createPopover(): BrowserWindow {
  const win = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    transparent: process.platform === 'darwin',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#08090a',
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened()) win.hide();
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

function notifyChange(): void {
  popover?.webContents.send('tasks:changed');
  tray?.refreshBadge();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => tray?.show());

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.hide();

    await initDb();
    popover = createPopover();
    tray = new TrayController();
    tray.init(popover);
    registerIpc(notifyChange);
    startHookServer(notifyChange);

    const registered = globalShortcut.register(TOGGLE_HOTKEY, () => tray.toggle());
    if (!registered) {
      console.warn(`Failed to register hotkey ${TOGGLE_HOTKEY}`);
    }

    const POLL_MS = 5 * 60 * 1000;
    setInterval(async () => {
      try {
        await runAllCollectors();
        notifyChange();
      } catch {}
    }, POLL_MS);

    setInterval(() => tray.refreshBadge(), 60_000);

    setInterval(() => checkNudges({ tray }), 60_000);
    checkNudges({ tray });

    const reconcileLoop = async () => {
      const cfg = settings.getReconciler();
      if (!cfg.enabled || !settings.hasApiKey()) return;
      try {
        const r = await runReconciler();
        if (r.created > 0 || r.merged > 0) notifyChange();
      } catch {}
    };
    const RECONCILER_MS = settings.getReconciler().intervalMinutes * 60_000;
    setInterval(reconcileLoop, RECONCILER_MS);
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopHookServer();
  try {
    saveDbNow();
  } catch {}
});

app.on('window-all-closed', () => {
  // Tray-only app: keep alive even when popover closes.
});
