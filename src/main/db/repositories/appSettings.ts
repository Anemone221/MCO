import { getDb } from '../index';

/**
 * Main-process preferences (see migration v24). Values are stored as text;
 * booleans as '1' / '0'. Unknown keys read as the caller's fallback, so a fresh
 * profile never needs seeding.
 */
export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, value);
}

export function getFlag(key: string, fallback = false): boolean {
  const value = getSetting(key);
  return value === null ? fallback : value === '1';
}

export function setFlag(key: string, value: boolean): void {
  setSetting(key, value ? '1' : '0');
}
