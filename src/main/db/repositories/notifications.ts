import type { AppNotification } from '@shared/types';
import { getDb } from '../index';

interface NotificationRow {
  id: number;
  kind: string;
  character_id: number | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
}

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    kind: row.kind,
    characterId: row.character_id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
    dismissedAt: row.dismissed_at,
  };
}

const COLUMNS = 'id, kind, character_id, title, body, created_at, read_at, dismissed_at';

/**
 * The rows the bell shows: everything not dismissed, newest first.
 *
 * Dismissed rows stay in the table as the record that their occurrence was
 * already raised (see the v37 migration) — they are filtered out here, not
 * deleted, so a dismissed warning cannot come back on the next sweep.
 */
export function listNotifications(): AppNotification[] {
  const rows = getDb()
    .prepare(
      `SELECT ${COLUMNS} FROM notifications
        WHERE dismissed_at IS NULL
        ORDER BY created_at DESC`,
    )
    .all() as NotificationRow[];
  return rows.map(toNotification);
}

export function getNotification(id: number): AppNotification | null {
  const row = getDb().prepare(`SELECT ${COLUMNS} FROM notifications WHERE id = ?`).get(id) as
    | NotificationRow
    | undefined;
  return row ? toNotification(row) : null;
}

export function countUnread(): number {
  const row = getDb()
    .prepare(
      'SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL',
    )
    .get() as { count: number };
  return row.count;
}

export function markRead(id: number): void {
  getDb()
    .prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL")
    .run(id);
}

export function markAllRead(): void {
  getDb()
    .prepare(
      `UPDATE notifications SET read_at = datetime('now')
       WHERE read_at IS NULL AND dismissed_at IS NULL`,
    )
    .run();
}

/**
 * Dismiss one notification: it leaves the bell for good.
 *
 * Dismissing also marks it read — the badge counts undismissed unread rows, and
 * a row the user has actively cleared is not one they still need to look at.
 */
export function dismissNotification(id: number): void {
  getDb()
    .prepare(
      `UPDATE notifications
          SET dismissed_at = datetime('now'),
              read_at = COALESCE(read_at, datetime('now'))
        WHERE id = ? AND dismissed_at IS NULL`,
    )
    .run(id);
}

/** Dismiss every notification currently listed. Returns how many were cleared. */
export function dismissAllNotifications(): number {
  const info = getDb()
    .prepare(
      `UPDATE notifications
          SET dismissed_at = datetime('now'),
              read_at = COALESCE(read_at, datetime('now'))
        WHERE dismissed_at IS NULL`,
    )
    .run();
  return info.changes;
}

/**
 * Delete dismissed notifications created more than `olderThanDays` days ago.
 * Returns how many rows went.
 *
 * A dismissed row is kept because it is the record that its occurrence was
 * already raised (see the v37 migration): delete it while the occurrence is
 * still current and the next sweep raises it again. So the age is measured
 * from `created_at`, not `dismissed_at`, and must be longer than any kind
 * stays current — a queue-drain warning for 3 days, an elapsed timer for 24
 * hours, an idle Omega account for the day in its key. Undismissed rows are
 * never touched; those are the user's to clear.
 */
export function pruneDismissedNotifications(olderThanDays: number): number {
  const info = getDb()
    .prepare(
      `DELETE FROM notifications
        WHERE dismissed_at IS NOT NULL
          AND created_at < datetime('now', ?)`,
    )
    .run(`-${olderThanDays} days`);
  return info.changes;
}

/** Insert a notification, or return null if its dedupe_key already exists. */
export function createNotification(input: {
  kind: string;
  dedupeKey: string;
  characterId: number | null;
  title: string;
  body: string;
}): AppNotification | null {
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO notifications (kind, dedupe_key, character_id, title, body)
       VALUES (@kind, @dedupeKey, @characterId, @title, @body)`,
    )
    .run(input);
  if (info.changes === 0) return null;
  return getNotification(Number(info.lastInsertRowid));
}
