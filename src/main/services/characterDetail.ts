import type { CharacterDetail } from '@shared/types';
import { getCharacter } from '../db/repositories/characters';
import { getTotalSp } from '../db/repositories/skills';
import { getSystems, getTypeNames } from '../db/repositories/sde';
import {
  getCharacterImplants,
  getCharacterLocation,
  getCharacterShip,
} from '../esi/endpoints';
import { getSkillQueue } from './characterSync';

/**
 * Assemble the character detail view. Stored data (skills, queue) is read from
 * the DB; live data (location, ship, implants) is fetched from ESI, and each
 * live call is tolerated independently so one failure does not blank the page.
 */
export async function buildCharacterDetail(characterId: number): Promise<CharacterDetail> {
  const character = getCharacter(characterId);
  if (!character) throw new Error(`Unknown character ${characterId}`);

  const skillQueue = getSkillQueue(characterId);
  const totalSp = getTotalSp(characterId);

  const [locationResult, shipResult, implantsResult] = await Promise.allSettled([
    getCharacterLocation(characterId),
    getCharacterShip(characterId),
    getCharacterImplants(characterId),
  ]);

  let location: CharacterDetail['location'] = null;
  if (locationResult.status === 'fulfilled') {
    const systemId = locationResult.value.solar_system_id;
    location = {
      solarSystemId: systemId,
      solarSystemName: getSystems([systemId]).get(systemId)?.name ?? null,
    };
  }

  let ship: CharacterDetail['ship'] = null;
  if (shipResult.status === 'fulfilled') {
    const typeName = getTypeNames([shipResult.value.ship_type_id]).get(
      shipResult.value.ship_type_id,
    );
    ship = {
      typeId: shipResult.value.ship_type_id,
      typeName: typeName ?? null,
      name: shipResult.value.ship_name,
    };
  }

  let implants: CharacterDetail['implants'] = [];
  if (implantsResult.status === 'fulfilled') {
    const names = getTypeNames(implantsResult.value);
    implants = implantsResult.value.map((typeId) => ({
      typeId,
      typeName: names.get(typeId) ?? null,
    }));
  }

  return { character, totalSp, skillQueue, location, ship, implants };
}
