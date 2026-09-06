import { getDb } from '../index';

/**
 * Mercenary Dens and the tactical operations offered at them.
 *
 * Both are stored as a *replacement* per character rather than an upsert:
 * ESI's listings are the current truth, and a den that was unanchored or an
 * operation that rolled over simply stops appearing in them. Merging would
 * leave the board showing dens the character no longer owns.
 *
 * The two writes are split — dens and operations come from different
 * endpoints, behind different scopes, and either can fail on its own — so a
 * character whose operations request fails keeps the dens it already reported.
 */

export interface MercenaryDenRow {
  denId: number;
  characterId: number;
  planetId: number;
  typeId: number | null;
  state: string | null;
  skyhookId: number | null;
  skyhookCorporationId: number | null;
  skyhookCorporationName: string | null;
  infomorphs: number | null;
  developmentAmount: number | null;
  developmentLevel: number | null;
  anarchyAmount: number | null;
  anarchyLevel: number | null;
  reinforcementEnd: string | null;
  detailSyncedAt: string | null;
  updatedAt: string | null;
}

interface MercenaryDenDbRow {
  den_id: number;
  character_id: number;
  planet_id: number;
  type_id: number | null;
  state: string | null;
  skyhook_id: number | null;
  skyhook_corporation_id: number | null;
  skyhook_corporation_name: string | null;
  infomorphs: number | null;
  development_amount: number | null;
  development_level: number | null;
  anarchy_amount: number | null;
  anarchy_level: number | null;
  reinforcement_end: string | null;
  detail_synced_at: string | null;
  updated_at: string | null;
}

function toDenRow(row: MercenaryDenDbRow): MercenaryDenRow {
  return {
    denId: row.den_id,
    characterId: row.character_id,
    planetId: row.planet_id,
    typeId: row.type_id,
    state: row.state,
    skyhookId: row.skyhook_id,
    skyhookCorporationId: row.skyhook_corporation_id,
    skyhookCorporationName: row.skyhook_corporation_name,
    infomorphs: row.infomorphs,
    developmentAmount: row.development_amount,
    developmentLevel: row.development_level,
    anarchyAmount: row.anarchy_amount,
    anarchyLevel: row.anarchy_level,
    reinforcementEnd: row.reinforcement_end,
    detailSyncedAt: row.detail_synced_at,
    updatedAt: row.updated_at,
  };
}

const DEN_COLUMNS = `den_id, character_id, planet_id, type_id, state, skyhook_id,
                     skyhook_corporation_id, skyhook_corporation_name, infomorphs,
                     development_amount, development_level, anarchy_amount, anarchy_level,
                     reinforcement_end, detail_synced_at, updated_at`;

/** Every den on record, for the board. */
export function listMercenaryDens(): MercenaryDenRow[] {
  return (
    getDb().prepare(`SELECT ${DEN_COLUMNS} FROM mercenary_dens`).all() as MercenaryDenDbRow[]
  ).map(toDenRow);
}

export function listMercenaryDensForCharacter(characterId: number): MercenaryDenRow[] {
  return (
    getDb()
      .prepare(`SELECT ${DEN_COLUMNS} FROM mercenary_dens WHERE character_id = ?`)
      .all(characterId) as MercenaryDenDbRow[]
  ).map(toDenRow);
}

/**
 * Set which dens a character holds, from the listing endpoint.
 *
 * Only (den_id, planet_id) are known here — the detail columns are left
 * untouched on a den that was already on record, so a sweep whose detail reads
 * fail keeps last sweep's readings rather than blanking the board. Dens absent
 * from the listing are deleted: they were unanchored.
 */
export function replaceMercenaryDens(
  characterId: number,
  dens: Array<{ denId: number; planetId: number }>,
): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO mercenary_dens (den_id, character_id, planet_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(den_id) DO UPDATE SET
       character_id = excluded.character_id,
       planet_id = excluded.planet_id,
       updated_at = excluded.updated_at`,
  );
  const del = db.prepare('DELETE FROM mercenary_dens WHERE den_id = ?');
  const existing = db.prepare('SELECT den_id FROM mercenary_dens WHERE character_id = ?');
  db.transaction(() => {
    const keep = new Set(dens.map((d) => d.denId));
    for (const row of existing.all(characterId) as Array<{ den_id: number }>) {
      if (!keep.has(row.den_id)) del.run(row.den_id);
    }
    for (const den of dens) insert.run(den.denId, characterId, den.planetId);
    touchDensSynced(characterId);
  })();
}

export interface MercenaryDenDetailInput {
  denId: number;
  typeId: number;
  state: string;
  skyhookId: number;
  skyhookCorporationId: number;
  /** Null when the public corporation lookup failed; the id is still recorded. */
  skyhookCorporationName: string | null;
  infomorphs: number;
  developmentAmount: number;
  developmentLevel: number | null;
  anarchyAmount: number;
  anarchyLevel: number | null;
  reinforcementEnd: string | null;
}

/**
 * Store one den's detail read.
 *
 * An UPDATE rather than an upsert: the row is created by the listing, which is
 * what establishes that this character holds this den. A detail arriving for a
 * den no listing mentioned would be a den nobody owns, and is dropped.
 */
export function updateMercenaryDenDetail(detail: MercenaryDenDetailInput): void {
  getDb()
    .prepare(
      `UPDATE mercenary_dens SET
         type_id = @typeId,
         state = @state,
         skyhook_id = @skyhookId,
         skyhook_corporation_id = @skyhookCorporationId,
         skyhook_corporation_name = @skyhookCorporationName,
         infomorphs = @infomorphs,
         development_amount = @developmentAmount,
         development_level = @developmentLevel,
         anarchy_amount = @anarchyAmount,
         anarchy_level = @anarchyLevel,
         reinforcement_end = @reinforcementEnd,
         detail_synced_at = datetime('now'),
         updated_at = datetime('now')
       WHERE den_id = @denId`,
    )
    .run(detail);
}

export interface MercenaryOperationRow {
  operationId: string;
  characterId: number;
  denId: number;
  state: string | null;
  dungeonTypeId: number | null;
  expires: string | null;
  updatedAt: string | null;
}

interface MercenaryOperationDbRow {
  operation_id: string;
  character_id: number;
  mercenary_den_id: number;
  state: string | null;
  dungeon_type_id: number | null;
  expires: string | null;
  updated_at: string | null;
}

function toOperationRow(row: MercenaryOperationDbRow): MercenaryOperationRow {
  return {
    operationId: row.operation_id,
    characterId: row.character_id,
    denId: row.mercenary_den_id,
    state: row.state,
    dungeonTypeId: row.dungeon_type_id,
    expires: row.expires,
    updatedAt: row.updated_at,
  };
}

const OPERATION_COLUMNS =
  'operation_id, character_id, mercenary_den_id, state, dungeon_type_id, expires, updated_at';

export function listMercenaryOperations(): MercenaryOperationRow[] {
  return (
    getDb()
      .prepare(`SELECT ${OPERATION_COLUMNS} FROM mercenary_operations`)
      .all() as MercenaryOperationDbRow[]
  ).map(toOperationRow);
}

/**
 * Set which operations a character has on offer.
 *
 * Same replacement rule as dens, and for a sharper reason: an offer that has
 * rolled over is not merely stale, it is gone — the den now offers a different
 * one — so keeping it would put work on the board that cannot be done.
 *
 * Detail columns are preserved for an operation that is still listed, so a
 * failed detail read costs nothing already known.
 */
export function replaceMercenaryOperations(
  characterId: number,
  operations: Array<{ operationId: string; denId: number }>,
): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO mercenary_operations (operation_id, character_id, mercenary_den_id, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(operation_id) DO UPDATE SET
       character_id = excluded.character_id,
       mercenary_den_id = excluded.mercenary_den_id,
       updated_at = excluded.updated_at`,
  );
  const del = db.prepare('DELETE FROM mercenary_operations WHERE operation_id = ?');
  const existing = db.prepare(
    'SELECT operation_id FROM mercenary_operations WHERE character_id = ?',
  );
  db.transaction(() => {
    const keep = new Set(operations.map((o) => o.operationId));
    for (const row of existing.all(characterId) as Array<{ operation_id: string }>) {
      if (!keep.has(row.operation_id)) del.run(row.operation_id);
    }
    for (const op of operations) insert.run(op.operationId, characterId, op.denId);
    touchOperationsSynced(characterId);
  })();
}

export function updateMercenaryOperationDetail(detail: {
  operationId: string;
  state: string;
  dungeonTypeId: number;
  expires: string;
}): void {
  getDb()
    .prepare(
      `UPDATE mercenary_operations SET
         state = @state,
         dungeon_type_id = @dungeonTypeId,
         expires = @expires,
         updated_at = datetime('now')
       WHERE operation_id = @operationId`,
    )
    .run(detail);
}

function touchDensSynced(characterId: number): void {
  getDb()
    .prepare(
      `INSERT INTO mercenary_den_sync (character_id, dens_synced_at)
       VALUES (?, datetime('now'))
       ON CONFLICT(character_id) DO UPDATE SET dens_synced_at = datetime('now')`,
    )
    .run(characterId);
}

function touchOperationsSynced(characterId: number): void {
  getDb()
    .prepare(
      `INSERT INTO mercenary_den_sync (character_id, operations_synced_at)
       VALUES (?, datetime('now'))
       ON CONFLICT(character_id) DO UPDATE SET operations_synced_at = datetime('now')`,
    )
    .run(characterId);
}

/**
 * Which characters have had a den listing read at least once — the difference
 * between "holds no dens" and "we have never looked", which is what the
 * board's `pending` status turns on.
 */
export function getMercenaryDenSyncedIds(): Set<number> {
  const rows = getDb()
    .prepare('SELECT character_id FROM mercenary_den_sync WHERE dens_synced_at IS NOT NULL')
    .all() as Array<{ character_id: number }>;
  return new Set(rows.map((r) => r.character_id));
}
