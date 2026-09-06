import { getDb } from '../index';

/**
 * Planet names, resolved once from ESI's public `/universe/planets` route.
 *
 * Deliberately has no refresh policy, unlike `structures.ts`: a planet cannot
 * be renamed, moved to another system or destroyed, so a resolved row is
 * correct forever. Only a *failed* lookup is worth retrying, which is the one
 * thing `failed_at` records.
 */

export interface PlanetRow {
  planetId: number;
  /** Null while the id is known but has never been resolved. */
  name: string | null;
  solarSystemId: number | null;
  typeId: number | null;
  resolvedAt: string | null;
  failedAt: string | null;
}

interface PlanetDbRow {
  planet_id: number;
  name: string | null;
  solar_system_id: number | null;
  type_id: number | null;
  resolved_at: string | null;
  failed_at: string | null;
}

function toRow(row: PlanetDbRow): PlanetRow {
  return {
    planetId: row.planet_id,
    name: row.name,
    solarSystemId: row.solar_system_id,
    typeId: row.type_id,
    resolvedAt: row.resolved_at,
    failedAt: row.failed_at,
  };
}

/** Chunked to stay under SQLite's bind-variable cap, as elsewhere. */
const IN_CHUNK = 500;

export function getPlanets(planetIds: number[]): Map<number, PlanetRow> {
  const result = new Map<number, PlanetRow>();
  for (let i = 0; i < planetIds.length; i += IN_CHUNK) {
    const chunk = planetIds.slice(i, i + IN_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = getDb()
      .prepare(
        `SELECT planet_id, name, solar_system_id, type_id, resolved_at, failed_at
         FROM planets WHERE planet_id IN (${placeholders})`,
      )
      .all(...chunk) as PlanetDbRow[];
    for (const row of rows) result.set(row.planet_id, toRow(row));
  }
  return result;
}

export function upsertPlanet(planet: {
  planetId: number;
  name: string;
  solarSystemId: number;
  typeId: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO planets (planet_id, name, solar_system_id, type_id, resolved_at, failed_at)
       VALUES (@planetId, @name, @solarSystemId, @typeId, datetime('now'), NULL)
       ON CONFLICT(planet_id) DO UPDATE SET
         name = excluded.name,
         solar_system_id = excluded.solar_system_id,
         type_id = excluded.type_id,
         resolved_at = excluded.resolved_at,
         failed_at = NULL`,
    )
    .run(planet);
}

/**
 * Record that a lookup failed, so the next sweep can back off rather than
 * re-requesting a bad id every hour. The name stays whatever it was — a
 * transient failure must not blank an address the board is already showing.
 */
export function markPlanetFailed(planetId: number): void {
  getDb()
    .prepare(
      `INSERT INTO planets (planet_id, failed_at) VALUES (?, datetime('now'))
       ON CONFLICT(planet_id) DO UPDATE SET failed_at = datetime('now')`,
    )
    .run(planetId);
}
