import type { MiningWindow } from '../../mining/window';
import { getDb } from '../index';

/**
 * The mining ledger: reads and writes of `character_mining_ledger`, plus the
 * aggregates the Mining page is made of.
 *
 * Every aggregate joins `sde_types` for the per-unit volume, because m³ — not
 * ESI's unit count — is the number a miner reads. A type the imported SDE has
 * no volume for contributes nothing to the m³ column (SQLite's SUM skips the
 * null product), which is why each aggregate also reports how many such types
 * it saw: a short total that says it is short beats a wrong one that stays
 * quiet.
 */

export interface MiningEntryInput {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  solarSystemId: number;
  typeId: number;
  quantity: number;
}

/**
 * Store one character's ledger rows.
 *
 * A conflict is the same (day, system, type) bucket seen again, and the
 * quantity is *replaced* rather than added to: ESI reports each bucket's
 * running total, so today's row grows through the day and every sweep re-reads
 * it. Adding would multiply a day's mining by the number of sweeps that saw it.
 */
export function upsertMiningEntries(characterId: number, entries: MiningEntryInput[]): void {
  if (entries.length === 0) return;
  const stmt = getDb().prepare(
    `INSERT INTO character_mining_ledger
       (character_id, day, solar_system_id, type_id, quantity)
     VALUES (@characterId, @day, @solarSystemId, @typeId, @quantity)
     ON CONFLICT (character_id, day, solar_system_id, type_id) DO UPDATE SET
       quantity = excluded.quantity`,
  );
  const insertMany = getDb().transaction((rows: MiningEntryInput[]) => {
    for (const row of rows) stmt.run({ characterId, ...row });
  });
  insertMany(entries);
}

/**
 * The window as a WHERE clause plus its bound parameters. Day keys are
 * `YYYY-MM-DD`, so string comparison is date comparison, and both ends are
 * inclusive — the window is a run of calendar days, not a half-open instant
 * range.
 */
function windowClause(window: MiningWindow): { sql: string; params: string[] } {
  return {
    sql: 'WHERE m.day >= ? AND m.day <= ?',
    params: [window.startDay, window.endDay],
  };
}

/** The volume expression every aggregate shares: units × the SDE's m³ per unit. */
const VOLUME_SQL = 'COALESCE(SUM(m.quantity * t.volume), 0) AS volume_m3';
/** Distinct mined types the SDE could not price in m³ (no row for it, or no volume on it). */
const MISSING_VOLUME_SQL =
  'COUNT(DISTINCT CASE WHEN t.volume IS NULL THEN m.type_id END) AS types_missing_volume';
/** Aggregates read the ledger joined to its types; LEFT, so an unknown type still counts units. */
const FROM_SQL = 'FROM character_mining_ledger m LEFT JOIN sde_types t ON t.id = m.type_id';

export interface MiningTotalsRow {
  units: number;
  volumeM3: number;
  oreTypes: number;
  characters: number;
  systems: number;
  typesMissingVolume: number;
}

/** Window-wide totals: how much, of how many kinds, by how many characters, where. */
export function sumMiningTotals(window: MiningWindow): MiningTotalsRow {
  const { sql, params } = windowClause(window);
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(m.quantity), 0) AS units,
              ${VOLUME_SQL},
              COUNT(DISTINCT m.type_id) AS ore_types,
              COUNT(DISTINCT m.character_id) AS characters,
              COUNT(DISTINCT m.solar_system_id) AS systems,
              ${MISSING_VOLUME_SQL}
       ${FROM_SQL}
       ${sql}`,
    )
    .get(...params) as {
    units: number;
    volume_m3: number;
    ore_types: number;
    characters: number;
    systems: number;
    types_missing_volume: number;
  };
  return {
    units: row.units,
    volumeM3: row.volume_m3,
    oreTypes: row.ore_types,
    characters: row.characters,
    systems: row.systems,
    typesMissingVolume: row.types_missing_volume,
  };
}

export interface MiningDayRow {
  day: string;
  units: number;
  volumeM3: number;
}

/** Per UTC day, days with activity only, oldest first. */
export function sumMiningByDay(window: MiningWindow): MiningDayRow[] {
  const { sql, params } = windowClause(window);
  const rows = getDb()
    .prepare(
      `SELECT m.day AS day, COALESCE(SUM(m.quantity), 0) AS units, ${VOLUME_SQL}
       ${FROM_SQL}
       ${sql}
       GROUP BY m.day
       ORDER BY m.day`,
    )
    .all(...params) as Array<{ day: string; units: number; volume_m3: number }>;
  return rows.map((row) => ({ day: row.day, units: row.units, volumeM3: row.volume_m3 }));
}

export interface MiningCharacterAggregate {
  characterId: number;
  units: number;
  volumeM3: number;
  oreTypes: number;
  systems: number;
  lastMinedDay: string;
}

/** Per character, biggest hauler first. Characters that mined nothing are simply absent. */
export function sumMiningByCharacter(window: MiningWindow): MiningCharacterAggregate[] {
  const { sql, params } = windowClause(window);
  const rows = getDb()
    .prepare(
      `SELECT m.character_id AS character_id,
              COALESCE(SUM(m.quantity), 0) AS units,
              ${VOLUME_SQL},
              COUNT(DISTINCT m.type_id) AS ore_types,
              COUNT(DISTINCT m.solar_system_id) AS systems,
              MAX(m.day) AS last_day
       ${FROM_SQL}
       ${sql}
       GROUP BY m.character_id
       ORDER BY volume_m3 DESC, units DESC`,
    )
    .all(...params) as Array<{
    character_id: number;
    units: number;
    volume_m3: number;
    ore_types: number;
    systems: number;
    last_day: string;
  }>;
  return rows.map((row) => ({
    characterId: row.character_id,
    units: row.units,
    volumeM3: row.volume_m3,
    oreTypes: row.ore_types,
    systems: row.systems,
    lastMinedDay: row.last_day,
  }));
}

export interface MiningOreAggregate {
  typeId: number;
  typeName: string | null;
  groupName: string | null;
  unitVolumeM3: number | null;
  units: number;
  volumeM3: number;
  characters: number;
}

/**
 * Per ore/ice/gas type. Names and the SDE group are joined here rather than
 * resolved afterwards: the aggregate is already reading `sde_types`, and the
 * group ("Veldspar", "Ice", "Gas Clouds") is what makes a table of forty ore
 * variants readable.
 */
export function sumMiningByOre(window: MiningWindow): MiningOreAggregate[] {
  const { sql, params } = windowClause(window);
  const rows = getDb()
    .prepare(
      `SELECT m.type_id AS type_id,
              t.name AS type_name,
              g.name AS group_name,
              t.volume AS unit_volume,
              COALESCE(SUM(m.quantity), 0) AS units,
              ${VOLUME_SQL},
              COUNT(DISTINCT m.character_id) AS characters
       ${FROM_SQL}
       LEFT JOIN sde_groups g ON g.id = t.group_id
       ${sql}
       GROUP BY m.type_id
       ORDER BY volume_m3 DESC, units DESC`,
    )
    .all(...params) as Array<{
    type_id: number;
    type_name: string | null;
    group_name: string | null;
    unit_volume: number | null;
    units: number;
    volume_m3: number;
    characters: number;
  }>;
  return rows.map((row) => ({
    typeId: row.type_id,
    typeName: row.type_name,
    groupName: row.group_name,
    unitVolumeM3: row.unit_volume,
    units: row.units,
    volumeM3: row.volume_m3,
    characters: row.characters,
  }));
}

export interface MiningSystemAggregate {
  solarSystemId: number;
  systemName: string | null;
  security: number | null;
  regionName: string | null;
  units: number;
  volumeM3: number;
  characters: number;
}

/** Per solar system, with the security and region the page colour-codes by. */
export function sumMiningBySystem(window: MiningWindow): MiningSystemAggregate[] {
  const { sql, params } = windowClause(window);
  const rows = getDb()
    .prepare(
      `SELECT m.solar_system_id AS system_id,
              s.name AS system_name,
              s.security AS security,
              r.name AS region_name,
              COALESCE(SUM(m.quantity), 0) AS units,
              ${VOLUME_SQL},
              COUNT(DISTINCT m.character_id) AS characters
       ${FROM_SQL}
       LEFT JOIN sde_systems s ON s.id = m.solar_system_id
       LEFT JOIN sde_regions r ON r.id = s.region_id
       ${sql}
       GROUP BY m.solar_system_id
       ORDER BY volume_m3 DESC, units DESC`,
    )
    .all(...params) as Array<{
    system_id: number;
    system_name: string | null;
    security: number | null;
    region_name: string | null;
    units: number;
    volume_m3: number;
    characters: number;
  }>;
  return rows.map((row) => ({
    solarSystemId: row.system_id,
    systemName: row.system_name,
    security: row.security,
    regionName: row.region_name,
    units: row.units,
    volumeM3: row.volume_m3,
    characters: row.characters,
  }));
}

/**
 * The oldest day banked, across every character — how far back "everything
 * recorded" actually reaches. Null on a profile that has never stored a mining
 * row.
 */
export function firstMiningDay(): string | null {
  const row = getDb().prepare('SELECT MIN(day) AS day FROM character_mining_ledger').get() as {
    day: string | null;
  };
  return row.day;
}
