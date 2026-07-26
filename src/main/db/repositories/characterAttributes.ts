import { getDb } from '../index';

export interface CharacterAttributesRow {
  characterId: number;
  intelligence: number;
  memory: number;
  charisma: number;
  perception: number;
  willpower: number;
  /** Stock of bonus remaps; null when ESI omits it. */
  bonusRemaps: number | null;
  /** Null if the character has never remapped. */
  lastRemapDate: string | null;
  /** When the accrued (yearly) remap becomes available; null/past = available. */
  accruedRemapCooldownDate: string | null;
  updatedAt: string;
}

interface AttributesDbRow {
  character_id: number;
  intelligence: number;
  memory: number;
  charisma: number;
  perception: number;
  willpower: number;
  bonus_remaps: number | null;
  last_remap_date: string | null;
  accrued_remap_cooldown_date: string | null;
  updated_at: string;
}

function toRow(row: AttributesDbRow): CharacterAttributesRow {
  return {
    characterId: row.character_id,
    intelligence: row.intelligence,
    memory: row.memory,
    charisma: row.charisma,
    perception: row.perception,
    willpower: row.willpower,
    bonusRemaps: row.bonus_remaps,
    lastRemapDate: row.last_remap_date,
    accruedRemapCooldownDate: row.accrued_remap_cooldown_date,
    updatedAt: row.updated_at,
  };
}

export function upsertCharacterAttributes(input: {
  characterId: number;
  intelligence: number;
  memory: number;
  charisma: number;
  perception: number;
  willpower: number;
  bonusRemaps: number | null;
  lastRemapDate: string | null;
  accruedRemapCooldownDate: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO character_attributes
         (character_id, intelligence, memory, charisma, perception, willpower,
          bonus_remaps, last_remap_date, accrued_remap_cooldown_date, updated_at)
       VALUES (@characterId, @intelligence, @memory, @charisma, @perception, @willpower,
          @bonusRemaps, @lastRemapDate, @accruedRemapCooldownDate, datetime('now'))
       ON CONFLICT(character_id) DO UPDATE SET
         intelligence = excluded.intelligence,
         memory = excluded.memory,
         charisma = excluded.charisma,
         perception = excluded.perception,
         willpower = excluded.willpower,
         bonus_remaps = excluded.bonus_remaps,
         last_remap_date = excluded.last_remap_date,
         accrued_remap_cooldown_date = excluded.accrued_remap_cooldown_date,
         updated_at = excluded.updated_at`,
    )
    .run(input);
}

export function getCharacterAttributesRow(characterId: number): CharacterAttributesRow | null {
  const row = getDb()
    .prepare(
      `SELECT character_id, intelligence, memory, charisma, perception, willpower,
              bonus_remaps, last_remap_date, accrued_remap_cooldown_date, updated_at
       FROM character_attributes WHERE character_id = ?`,
    )
    .get(characterId) as AttributesDbRow | undefined;
  return row ? toRow(row) : null;
}
