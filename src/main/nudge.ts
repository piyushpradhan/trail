import { Notification } from 'electron';
import { tasksRepo, eventsRepo } from './db.js';
import type { TrayController } from './tray.js';

interface NudgeContext {
  tray: TrayController;
}

const STALE_HOURS = 6;
const EOD_HOUR = 17;
const MORNING_HOUR = 9;

let lastEodKey = '';
let lastMorningKey = '';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}

export function checkNudges(ctx: NudgeContext): void {
  const now = new Date();
  const hour = now.getHours();
  const key = todayKey();

  if (hour >= EOD_HOUR && lastEodKey !== key) {
    const open = tasksRepo
      .list({ status: ['todo', 'in_progress'] })
      .filter((t) => t.snoozedUntil == null || t.snoozedUntil < Date.now());

    if (open.length > 0) {
      const stalled = open.filter((t) => t.lastTouchedAt < Date.now() - STALE_HOURS * 3600_000);
      const lines = stalled.slice(0, 3).map((t) => `• ${t.title}`).join('\n');
      const summary = stalled.length > 0
        ? `${stalled.length} stalled today.\n${lines}`
        : `${open.length} task(s) still open.`;

      notify('Trail — End of day', summary, () => ctx.tray.show());
      eventsRepo.log('nudge.eod', { open: open.length, stalled: stalled.length });
    }
    lastEodKey = key;
  }

  if (hour === MORNING_HOUR && lastMorningKey !== key) {
    const open = tasksRepo.list({ status: ['todo', 'in_progress', 'blocked'] });
    if (open.length > 0) {
      notify('Trail — Morning brief', `${open.length} task(s) carried over.`, () =>
        ctx.tray.show(),
      );
      eventsRepo.log('nudge.morning', { open: open.length });
    }
    lastMorningKey = key;
  }
}
