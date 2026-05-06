import { Tray, Menu, BrowserWindow, nativeImage, screen, app } from 'electron';
import { join } from 'node:path';
import { tasksRepo } from './db.js';

const ICON_SIZE = 16;
const ICON_PATH = join(__dirname, '../../resources/tray.png');

function loadTrayIcon(): Electron.NativeImage {
  const img = nativeImage.createFromPath(ICON_PATH);
  if (img.isEmpty()) return nativeImage.createEmpty();
  return img.resize({ width: ICON_SIZE, height: ICON_SIZE });
}

export class TrayController {
  private tray: Tray | null = null;
  private window: BrowserWindow | null = null;

  init(window: BrowserWindow): void {
    this.window = window;
    const icon = loadTrayIcon();
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    this.tray = new Tray(icon);
    this.tray.setToolTip('Trail');
    this.tray.on('click', () => this.toggle());
    this.tray.on('right-click', () => {
      const menu = Menu.buildFromTemplate([
        { label: 'Open', accelerator: 'CmdOrCtrl+Shift+Space', click: () => this.show() },
        { label: 'Sync now', click: () => this.window?.webContents.send('trigger:sync') },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' },
      ]);
      this.tray?.popUpContextMenu(menu);
    });
    this.refreshBadge();
  }

  refreshBadge(): void {
    if (!this.tray) return;
    const stalled = tasksRepo.countStalled();
    this.tray.setTitle(stalled > 0 ? `  ${stalled}` : '');
    this.tray.setToolTip(stalled > 0 ? `Trail — ${stalled} stalled` : 'Trail');
    if (process.platform === 'win32' || process.platform === 'linux') {
      app.setBadgeCount?.(stalled);
    }
  }

  toggle(): void {
    if (!this.window) return;
    if (this.window.isVisible()) this.window.hide();
    else this.show();
  }

  show(): void {
    if (!this.window || !this.tray) return;
    const bounds = this.tray.getBounds();
    const winBounds = this.window.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x || 0, y: bounds.y || 0 });
    let x = Math.round(bounds.x + bounds.width / 2 - winBounds.width / 2);
    let y = Math.round(bounds.y + bounds.height + 4);
    if (process.platform === 'win32') {
      x = display.workArea.x + display.workArea.width - winBounds.width - 8;
      y = display.workArea.y + display.workArea.height - winBounds.height - 8;
    }
    x = Math.max(
      display.workArea.x + 8,
      Math.min(x, display.workArea.x + display.workArea.width - winBounds.width - 8),
    );
    this.window.setPosition(x, y, false);
    this.window.show();
    this.window.focus();
  }
}
