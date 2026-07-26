import { getDb } from '../index';

export interface StructureRow {
  structureId: number;
  /** Null while the id is known but no token has resolved it yet. */
  name: string | null;
  solarSystemId: number | null;
  typeId: number | null;
  ownerId: number | null;
  resolvedAt: string | null;
  failedAt: string | null;
}

interface StructureDbRow {
  structure_id: number;
  name: string | null;
  solar_system_id: number | null;
  type_id: number | null;
  owner_id: number | null;
  resolved_at: string | null;
  failed_at: string | null;
}

function toRow(row: StructureDbRow): StructureRow {
  return {
    structureId: row.structure_id,
    name: row.name,
    solarSystemId: row.solar_system_id,
    typeId: row.type_id,
    ownerId: row.owner_id,
    resolvedAt: row.resolved_at,
    failedAt: row.failed_at,
  };
}

/** Known structures and how many have a resolved name (Settings sync status). */
export function countStructures(): { total: number; resolved: number } {
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS total,
              COUNT(name) AS resolved
       FROM structures`,
    )
    .get() as { total: number; resolved: number };
}

/** Chunked so bulk callers (the ~900-id public list) stay under SQLite's bind-variable cap. */
const IN_CHUNK = 500;

export function getStructures(structureIds: number[]): Map<number, StructureRow> {
  const result = new Map<number, StructureRow>();
  for (let i = 0; i < structureIds.length; i += IN_CHUNK) {
    const chunk = structureIds.slice(i, i + IN_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = getDb()
      .prepare(
        `SELECT structure_id, name, solar_system_id, type_id, owner_id, resolved_at, failed_at
         FROM structures WHERE structure_id IN (${placeholders})`,
      )
      .all(...chunk) as StructureDbRow[];
    for (const row of rows) result.set(row.structure_id, toRow(row));
  }
  return result;
}

/** Resolved structure names for the given ids; unresolved ids are absent. */
export function getStructureNames(structureIds: number[]): Map<number, string> {
  const names = new Map<number, string>();
  for (const [id, row] of getStructures(structureIds)) {
    if (row.name !== null) names.set(id, row.name);
  }
  return names;
}

/**
 * Resolved structures whose name contains the query, for the home-station
 * picker. Case-insensitive; `%`/`_` in the query are matched literally.
 */
export function searchStructuresByName(query: string, limit = 15): StructureRow[] {
  const needle = query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  if (needle === '') return [];
  const rows = getDb()
    .prepare(
      `SELECT structure_id, name, solar_system_id, type_id, owner_id, resolved_at, failed_at
       FROM structures WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`,
    )
    .all(`%${needle}%`, limit) as StructureDbRow[];
  return rows.map(toRow);
}

/** Record a successful ESI resolution; clears any earlier failure stamp. */
export function upsertStructure(input: {
  structureId: number;
  name: string;
  solarSystemId: number;
  typeId: number | null;
  ownerId: number;
}): void {
  // ISO timestamps (not SQLite datetime('now')) because refreshPolicy compares
  // them with Date.parse, which reads bare "YYYY-MM-DD HH:MM:SS" as local time.
  getDb()
    .prepare(
      `INSERT INTO structures
         (structure_id, name, solar_system_id, type_id, owner_id, resolved_at, failed_at)
       VALUES (@structureId, @name, @solarSystemId, @typeId, @ownerId, @resolvedAt, NULL)
       ON CONFLICT(structure_id) DO UPDATE SET
         name = excluded.name,
         solar_system_id = excluded.solar_system_id,
         type_id = excluded.type_id,
         owner_id = excluded.owner_id,
         resolved_at = excluded.resolved_at,
         failed_at = NULL`,
    )
    .run({ ...input, resolvedAt: new Date().toISOString() });
}

/**
 * Record a failed resolution attempt (typically 403 — no docking access).
 * Previously resolved data is kept: a stale name beats a raw id.
 */
export function markStructureFailed(structureId: number): void {
  getDb()
    .prepare(
      `INSERT INTO structures (structure_id, failed_at)
       VALUES (@structureId, @failedAt)
       ON CONFLICT(structure_id) DO UPDATE SET failed_at = excluded.failed_at`,
    )
    .run({ structureId, failedAt: new Date().toISOString() });
}
