import { getDb } from '../index';

export interface CharacterLocationRow {
  characterId: number;
  solarSystemId: number | null;
  stationId: number | null;
  structureId: number | null;
  shipTypeId: number | null;
  shipName: string | null;
  updatedAt: string;
}

interface LocationDbRow {
  character_id: number;
  solar_system_id: number | null;
  station_id: number | null;
  structure_id: number | null;
  ship_type_id: number | null;
  ship_name: string | null;
  updated_at: string;
}

function toRow(row: LocationDbRow): CharacterLocationRow {
  return {
    characterId: row.character_id,
    solarSystemId: row.solar_system_id,
    stationId: row.station_id,
    structureId: row.structure_id,
    shipTypeId: row.ship_type_id,
    shipName: row.ship_name,
    updatedAt: row.updated_at,
  };
}

export function upsertCharacterLocation(input: {
  characterId: number;
  solarSystemId: number | null;
  stationId: number | null;
  structureId: number | null;
  shipTypeId: number | null;
  shipName: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO character_location
         (character_id, solar_system_id, station_id, structure_id, ship_type_id, ship_name, updated_at)
       VALUES (@characterId, @solarSystemId, @stationId, @structureId, @shipTypeId, @shipName, datetime('now'))
       ON CONFLICT(character_id) DO UPDATE SET
         solar_system_id = excluded.solar_system_id,
         station_id = excluded.station_id,
         structure_id = excluded.structure_id,
         ship_type_id = excluded.ship_type_id,
         ship_name = excluded.ship_name,
         updated_at = excluded.updated_at`,
    )
    .run(input);
}

export function listCharacterLocations(): CharacterLocationRow[] {
  const rows = getDb()
    .prepare(
      `SELECT character_id, solar_system_id, station_id, structure_id,
              ship_type_id, ship_name, updated_at
       FROM character_location`,
    )
    .all() as LocationDbRow[];
  return rows.map(toRow);
}
