import { Notification, type BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { createNotification, markRead } from '../db/repositories/notifications';
import { openWindow } from './backgroundMode';

/** How a caller reaches the main window, which may not exist in tray-only mode. */
export type GetWindow = () => BrowserWindow | null;

/** A notification a rule decided to raise, before it is known whether it is new. */
export interface PendingNotification {
  /** Groups the row by what raised it (`queue-drain`); not shown to the user. */
  kind: string;
  /**
   * Identifies the *occurrence*, not the notification: the dedupe-keyed insert
   * is what makes "notify once per distinct occurrence" hold across a repeated
   * sweep and across restarts. Include everything that makes this occurrence
   * distinct from the next one (`queue-drain:<characterId>:<finishDate>` — a
   * re-queued skill has a new finish date and so earns a new warning) and
   * nothing that changes while it is still the same occurrence.
   */
  dedupeKey: string;
  characterId: number | null;
  title: string;
  body: string;
}

/**
 * The delivery half of the notification pipeline: dedupe-keyed insert, one
 * `notificationsChanged` ping, and an OS toast for each notification that was
 * actually new. Returns how many were delivered.
 *
 * This is the half every notification kind shares. The other half — gather
 * candidates, apply a rule — is the kind's own, and the rule itself belongs in
 * `src/main/notifications/` as a pure function over plain data (see
 * `queueDrain.ts`) so it can be unit-tested without Electron or the DB. A new
 * kind is that rule plus the reads that feed it and the sentence it produces;
 * nothing below this line changes.
 */
export function deliverNotifications(
  pending: PendingNotification[],
  getWindow: GetWindow,
): number {
  // A key already in the table means a previous sweep (or a previous run)
  // reported this occurrence: no row, no toast, no ping.
  const created = pending.map(createNotification).filter((n) => n !== null);
  if (created.length === 0) return 0;

  // One ping for the batch, not one per notification: the bell reloads the whole
  // list on the event, so N sends would be N identical reloads.
  getWindow()?.webContents.send(IpcChannel.notificationsChanged);

  if (Notification.isSupported()) {
    for (const notification of created) {
      const toast = new Notification({ title: notification.title, body: notification.body });
      toast.on('click', () => {
        markRead(notification.id);
        getWindow()?.webContents.send(IpcChannel.notificationsChanged);
        // Not getWindow()?.show(): in tray-only mode there is no window to show,
        // and clicking the toast would do nothing. This creates one if needed.
        openWindow();
      });
      toast.show();
    }
  }

  return created.length;
}
