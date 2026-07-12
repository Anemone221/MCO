import type { AccountBucket } from '@shared/types';
import { getDb } from '../index';

interface AccountRow {
  id: number;
  label: string;
  color: string | null;
}

export function listAccounts(): AccountBucket[] {
  return getDb()
    .prepare('SELECT id, label, color FROM accounts ORDER BY label')
    .all() as AccountRow[];
}

export function createAccount(label: string, color: string | null = null): AccountBucket {
  const info = getDb()
    .prepare('INSERT INTO accounts (label, color) VALUES (?, ?)')
    .run(label, color);
  return { id: Number(info.lastInsertRowid), label, color };
}

export function renameAccount(id: number, label: string): void {
  getDb().prepare('UPDATE accounts SET label = ? WHERE id = ?').run(label, id);
}

export function removeAccount(id: number): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
}
