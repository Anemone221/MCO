import { getDb } from '../index';

/** One blueprint item as ESI reports it, whoever holds it. */
export interface OwnedBlueprintRow {
  itemId: number;
  typeId: number;
  /** -1 original, -2 copy, positive = a stack of copies. */
  quantity: number;
  runs: number;
  materialEfficiency: number;
  timeEfficiency: number;
  locationId: number;
  locationFlag: string;
}

export interface CharacterBlueprintRow extends OwnedBlueprintRow {
  characterId: number;
}

export interface CorporationBlueprintRow extends OwnedBlueprintRow {
  corporationId: number;
}

const OWNED_COLUMNS =
  'item_id, type_id, quantity, runs, material_efficiency, time_efficiency, location_id, location_flag';

/** The same columns as an INSERT list, minus item_id (named first by the caller). */
const OWNED_INSERT_COLUMNS =
  'type_id, quantity, runs, material_efficiency, time_efficiency, location_id, location_flag';

const OWNED_INSERT_VALUES =
  '@typeId, @quantity, @runs, @materialEfficiency, @timeEfficiency, @locationId, @locationFlag';

interface OwnedRaw {
  item_id: number;
  type_id: number;
  quantity: number;
  runs: number;
  material_efficiency: number;
  time_efficiency: number;
  location_id: number;
  location_flag: string;
}

function toOwned(row: OwnedRaw): OwnedBlueprintRow {
  return {
    itemId: row.item_id,
    typeId: row.type_id,
    quantity: row.quantity,
    runs: row.runs,
    materialEfficiency: row.material_efficiency,
    timeEfficiency: row.time_efficiency,
    locationId: row.location_id,
    locationFlag: row.location_flag,
  };
}

/**
 * Replace a character's blueprints with what ESI just reported, and stamp the
 * character as having reported. `INSERT OR REPLACE` rather than plain INSERT:
 * item_id is unique across the game, so a blueprint handed to another character
 * would collide with its stale row if that character syncs first.
 */
export function replaceCharacterBlueprints(
  characterId: number,
  rows: OwnedBlueprintRow[],
): void {
  const db = getDb();
  const ins = db.prepare(
    `INSERT OR REPLACE INTO character_blueprints
       (item_id, character_id, ${OWNED_INSERT_COLUMNS})
     VALUES (@itemId, @characterId, ${OWNED_INSERT_VALUES})`,
  );
  db.transaction(() => {
    db.prepare('DELETE FROM character_blueprints WHERE character_id = ?').run(characterId);
    for (const r of rows) ins.run({ ...r, characterId });
    db.prepare(
      `INSERT INTO character_blueprints_meta (character_id) VALUES (?)
       ON CONFLICT(character_id) DO UPDATE SET updated_at = datetime('now')`,
    ).run(characterId);
  })();
}

export function listCharacterBlueprints(): CharacterBlueprintRow[] {
  const rows = getDb()
    .prepare(`SELECT character_id, ${OWNED_COLUMNS} FROM character_blueprints`)
    .all() as Array<OwnedRaw & { character_id: number }>;
  return rows.map((r) => ({ ...toOwned(r), characterId: r.character_id }));
}

/** When each character last reported its blueprints; absent = never reported. */
export function getCharacterBlueprintSyncTimes(): Map<number, string> {
  const rows = getDb()
    .prepare('SELECT character_id, updated_at FROM character_blueprints_meta')
    .all() as Array<{ character_id: number; updated_at: string }>;
  return new Map(rows.map((r) => [r.character_id, r.updated_at]));
}

export interface BlueprintCorpRow {
  corporationId: number;
  name: string | null;
  ticker: string | null;
  readerCharacterId: number;
  addedAt: string;
  syncedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

/**
 * Track a corporation's blueprint hangar, or re-point an already-tracked one at
 * a new reader character. Re-pointing clears any recorded error: the whole
 * reason to change reader is that the previous one could not read the hangar.
 */
export function upsertBlueprintCorp(input: {
  corporationId: number;
  name: string | null;
  ticker: string | null;
  readerCharacterId: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO blueprint_corps (corporation_id, name, ticker, reader_character_id)
       VALUES (@corporationId, @name, @ticker, @readerCharacterId)
       ON CONFLICT(corporation_id) DO UPDATE SET
         name                = excluded.name,
         ticker              = excluded.ticker,
         reader_character_id = excluded.reader_character_id,
         last_error          = NULL,
         last_error_at       = NULL`,
    )
    .run(input);
}

export function listBlueprintCorps(): BlueprintCorpRow[] {
  const rows = getDb()
    .prepare(
      `SELECT corporation_id, name, ticker, reader_character_id, added_at,
              synced_at, last_error, last_error_at
       FROM blueprint_corps ORDER BY name, corporation_id`,
    )
    .all() as Array<{
    corporation_id: number;
    name: string | null;
    ticker: string | null;
    reader_character_id: number;
    added_at: string;
    synced_at: string | null;
    last_error: string | null;
    last_error_at: string | null;
  }>;
  return rows.map((r) => ({
    corporationId: r.corporation_id,
    name: r.name,
    ticker: r.ticker,
    readerCharacterId: r.reader_character_id,
    addedAt: r.added_at,
    syncedAt: r.synced_at,
    lastError: r.last_error,
    lastErrorAt: r.last_error_at,
  }));
}

export function removeBlueprintCorp(corporationId: number): void {
  getDb().prepare('DELETE FROM blueprint_corps WHERE corporation_id = ?').run(corporationId);
}

/** Replace a corporation's blueprints, stamp it synced and clear any error. */
export function replaceCorporationBlueprints(
  corporationId: number,
  rows: OwnedBlueprintRow[],
): void {
  const db = getDb();
  const ins = db.prepare(
    `INSERT OR REPLACE INTO corporation_blueprints
       (item_id, corporation_id, ${OWNED_INSERT_COLUMNS})
     VALUES (@itemId, @corporationId, ${OWNED_INSERT_VALUES})`,
  );
  db.transaction(() => {
    db.prepare('DELETE FROM corporation_blueprints WHERE corporation_id = ?').run(corporationId);
    for (const r of rows) ins.run({ ...r, corporationId });
    db.prepare(
      `UPDATE blueprint_corps
       SET synced_at = datetime('now'), last_error = NULL, last_error_at = NULL
       WHERE corporation_id = ?`,
    ).run(corporationId);
  })();
}

/**
 * Record why a corporation's hangar could not be read (almost always: the
 * reader character is not a Director). Kept so the page can explain it, and so
 * scheduled sweeps can leave a known-failing corp alone instead of spending an
 * error-limit slot on the same 403 every hour.
 */
export function markBlueprintCorpError(corporationId: number, message: string): void {
  getDb()
    .prepare(
      `UPDATE blueprint_corps SET last_error = ?, last_error_at = datetime('now')
       WHERE corporation_id = ?`,
    )
    .run(message, corporationId);
}

export function listCorporationBlueprints(): CorporationBlueprintRow[] {
  const rows = getDb()
    .prepare(`SELECT corporation_id, ${OWNED_COLUMNS} FROM corporation_blueprints`)
    .all() as Array<OwnedRaw & { corporation_id: number }>;
  return rows.map((r) => ({ ...toOwned(r), corporationId: r.corporation_id }));
}
