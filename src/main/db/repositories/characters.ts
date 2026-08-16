import type { CharacterSummary } from '@shared/types';
import { getDb } from '../index';

interface CharacterRow {
  id: number;
  name: string;
  corp_id: number | null;
  alliance_id: number | null;
  account_id: number | null;
  added_at: string;
  refreshed_at: string | null;
}

const SELECT_COLUMNS =
  'id, name, corp_id, alliance_id, account_id, added_at, refreshed_at';

function toSummary(row: CharacterRow): CharacterSummary {
  return {
    id: row.id,
    name: row.name,
    corpId: row.corp_id,
    allianceId: row.alliance_id,
    accountId: row.account_id,
    addedAt: row.added_at,
    refreshedAt: row.refreshed_at,
  };
}

export function listCharacters(): CharacterSummary[] {
  const rows = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM characters ORDER BY name`)
    .all() as CharacterRow[];
  return rows.map(toSummary);
}

export function getCharacter(id: number): CharacterSummary | null {
  const row = getDb()
    .prepare(`SELECT ${SELECT_COLUMNS} FROM characters WHERE id = ?`)
    .get(id) as CharacterRow | undefined;
  return row ? toSummary(row) : null;
}

/**
 * Record a character by id and name alone, leaving everything else untouched.
 *
 * For the login path, where the JWT is all we have: it carries no corporation,
 * and re-running SSO for a character that already exists (widening its scopes,
 * or designating it a corp blueprint reader) must not blank the corp and
 * alliance a previous sync recorded. Use {@link upsertCharacter} when ESI's
 * public data is in hand and is authoritative.
 */
export function ensureCharacter(id: number, name: string): void {
  getDb()
    .prepare(
      `INSERT INTO characters (id, name) VALUES (@id, @name)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    )
    .run({ id, name });
}

/** Record a character from ESI public data; corp and alliance are overwritten. */
export function upsertCharacter(input: {
  id: number;
  name: string;
  corpId?: number | null;
  allianceId?: number | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO characters (id, name, corp_id, alliance_id)
       VALUES (@id, @name, @corpId, @allianceId)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         corp_id = excluded.corp_id,
         alliance_id = excluded.alliance_id`,
    )
    .run({
      id: input.id,
      name: input.name,
      corpId: input.corpId ?? null,
      allianceId: input.allianceId ?? null,
    });
}

export function assignAccount(characterId: number, accountId: number | null): void {
  getDb()
    .prepare('UPDATE characters SET account_id = ? WHERE id = ?')
    .run(accountId, characterId);
}

export function touchRefreshed(characterId: number): void {
  getDb()
    .prepare("UPDATE characters SET refreshed_at = datetime('now') WHERE id = ?")
    .run(characterId);
}

export function removeCharacter(id: number): void {
  getDb().prepare('DELETE FROM characters WHERE id = ?').run(id);
}
