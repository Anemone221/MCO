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
  };
}

const COLUMNS = 'id, kind, character_id, title, body, created_at, read_at';

export function listNotifications(): AppNotification[] {
  const rows = getDb()
    .prepare(`SELECT ${COLUMNS} FROM notifications ORDER BY created_at DESC`)
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
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL')
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
    .prepare("UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL")
    .run();
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
