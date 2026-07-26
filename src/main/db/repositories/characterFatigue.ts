import { getDb } from '../index';

export interface CharacterFatigueRow {
  characterId: number;
  /** When accumulated jump fatigue fully clears; null if never fatigued. */
  jumpFatigueExpireDate: string | null;
  lastJumpDate: string | null;
  updatedAt: string;
}

interface FatigueDbRow {
  character_id: number;
  jump_fatigue_expire_date: string | null;
  last_jump_date: string | null;
  updated_at: string;
}

function toRow(row: FatigueDbRow): CharacterFatigueRow {
  return {
    characterId: row.character_id,
    jumpFatigueExpireDate: row.jump_fatigue_expire_date,
    lastJumpDate: row.last_jump_date,
    updatedAt: row.updated_at,
  };
}

export function upsertCharacterFatigue(input: {
  characterId: number;
  jumpFatigueExpireDate: string | null;
  lastJumpDate: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO character_fatigue
         (character_id, jump_fatigue_expire_date, last_jump_date, updated_at)
       VALUES (@characterId, @jumpFatigueExpireDate, @lastJumpDate, datetime('now'))
       ON CONFLICT(character_id) DO UPDATE SET
         jump_fatigue_expire_date = excluded.jump_fatigue_expire_date,
         last_jump_date = excluded.last_jump_date,
         updated_at = excluded.updated_at`,
    )
    .run(input);
}

export function getCharacterFatigueRow(characterId: number): CharacterFatigueRow | null {
  const row = getDb()
    .prepare(
      `SELECT character_id, jump_fatigue_expire_date, last_jump_date, updated_at
       FROM character_fatigue WHERE character_id = ?`,
    )
    .get(characterId) as FatigueDbRow | undefined;
  return row ? toRow(row) : null;
}

export function listCharacterFatigue(): CharacterFatigueRow[] {
  const rows = getDb()
    .prepare(
      `SELECT character_id, jump_fatigue_expire_date, last_jump_date, updated_at
       FROM character_fatigue`,
    )
    .all() as FatigueDbRow[];
  return rows.map(toRow);
}
