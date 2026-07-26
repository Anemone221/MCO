import type { AccountBucket } from '@shared/types';
import { getDb } from '../index';

interface AccountRow {
  id: number;
  label: string;
  color: string | null;
  is_omega: number;
}

function toBucket(row: AccountRow): AccountBucket {
  return { id: row.id, label: row.label, color: row.color, isOmega: row.is_omega === 1 };
}

export function listAccounts(): AccountBucket[] {
  const rows = getDb()
    .prepare('SELECT id, label, color, is_omega FROM accounts ORDER BY label')
    .all() as AccountRow[];
  return rows.map(toBucket);
}

export function getAccount(id: number): AccountBucket | null {
  const row = getDb()
    .prepare('SELECT id, label, color, is_omega FROM accounts WHERE id = ?')
    .get(id) as AccountRow | undefined;
  return row ? toBucket(row) : null;
}

export function createAccount(label: string, color: string | null = null): AccountBucket {
  const info = getDb()
    .prepare('INSERT INTO accounts (label, color) VALUES (?, ?)')
    .run(label, color);
  return { id: Number(info.lastInsertRowid), label, color, isOmega: false };
}

export function renameAccount(id: number, label: string): void {
  getDb().prepare('UPDATE accounts SET label = ? WHERE id = ?').run(label, id);
}

export function setAccountOmega(id: number, isOmega: boolean): void {
  getDb().prepare('UPDATE accounts SET is_omega = ? WHERE id = ?').run(isOmega ? 1 : 0, id);
}

export function removeAccount(id: number): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
}
