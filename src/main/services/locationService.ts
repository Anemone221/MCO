import type { LocationEntry } from '@shared/types';
import { listAccounts } from '../db/repositories/accounts';
import { listCharacters } from '../db/repositories/characters';
import { listCharacterLocations } from '../db/repositories/characterLocation';
import { getSystems, getTypeNames } from '../db/repositories/sde';
import { getStructureNames } from '../db/repositories/structures';
import { resolveStationNames } from './cloneService';

function distinct(ids: Array<number | null>): number[] {
  return [...new Set(ids.filter((id): id is number => id !== null))];
}

/** Build the location dashboard: every character with its last-known, name-resolved location. */
export async function buildLocationBoard(): Promise<LocationEntry[]> {
  const characters = listCharacters();
  const locations = new Map(listCharacterLocations().map((l) => [l.characterId, l]));
  const accounts = new Map(listAccounts().map((a) => [a.id, a.label]));

  const values = [...locations.values()];
  const systems = getSystems(distinct(values.map((l) => l.solarSystemId)));
  const shipNames = getTypeNames(distinct(values.map((l) => l.shipTypeId)));
  const stationNames = await resolveStationNames(distinct(values.map((l) => l.stationId)));
  const structureNames = getStructureNames(distinct(values.map((l) => l.structureId)));

  return characters.map((character) => {
    const loc = locations.get(character.id);
    const system =
      loc?.solarSystemId != null ? systems.get(loc.solarSystemId) : undefined;
    return {
      characterId: character.id,
      characterName: character.name,
      accountLabel:
        character.accountId !== null ? (accounts.get(character.accountId) ?? null) : null,
      systemId: loc?.solarSystemId ?? null,
      systemName: system?.name ?? null,
      security: system?.security ?? null,
      regionId: system?.regionId ?? null,
      regionName: system?.regionName ?? null,
      docked: loc != null && (loc.stationId !== null || loc.structureId !== null),
      dockedName:
        loc?.stationId != null
          ? (stationNames.get(loc.stationId) ?? null)
          : loc?.structureId != null
            ? (structureNames.get(loc.structureId) ?? null)
            : null,
      shipName: loc?.shipName ?? null,
      shipTypeName:
        loc?.shipTypeId != null ? (shipNames.get(loc.shipTypeId) ?? null) : null,
      updatedAt: loc?.updatedAt ?? null,
    };
  });
}
