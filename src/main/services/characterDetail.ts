import type { CharacterDetail, JumpCloneEntry } from '@shared/types';
import { SCOPE_READ_WALLET } from '../config';
import { grantedScopes } from '../auth/token-store';
import { classifyEsiDataStatus, missingScopes } from '../auth/scopeStatus';
import { getCharacter, listCharacters } from '../db/repositories/characters';
import { getAccount } from '../db/repositories/accounts';
import { getCharacterAttributesRow } from '../db/repositories/characterAttributes';
import { getCharacterFatigueRow } from '../db/repositories/characterFatigue';
import { getCharacterWalletRow } from '../db/repositories/characterWallet';
import { getCloneMeta, getJumpClones } from '../db/repositories/clones';
import { getInvalidTokenIds } from '../db/repositories/tokens';
import {
  INFOMORPH_SYNCHRONIZING_TYPE_ID,
  nextCloneJumpDate,
} from '../clones/jumpCooldown';
import { listGroupsForCharacter } from '../db/repositories/groups';
import { listTagsForCharacter } from '../db/repositories/tags';
import { getActiveSkillLevel, getCharacterSkillGroupSp, getTotalSp } from '../db/repositories/skills';
import { getSystems, getTypeNames } from '../db/repositories/sde';
import { getStructureNames } from '../db/repositories/structures';
import {
  getCharacterImplants,
  getCharacterLocation,
  getCharacterShip,
} from '../esi/endpoints';
import { getSkillQueue, getTrainingStatus } from './characterSync';
import { locationDisplayName, resolveStationNames } from './cloneService';
import { listPlanProgressForCharacter } from './planService';

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
  const skillGroups = getCharacterSkillGroupSp(characterId);

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

  // Fatigue and clones come from the DB (populated by the sync cycle), not
  // live ESI — they change rarely and the sync already respects scope grants.
  const fatigueRow = getCharacterFatigueRow(characterId);
  const jumpFatigue = fatigueRow
    ? { expireDate: fatigueRow.jumpFatigueExpireDate, lastJumpDate: fatigueRow.lastJumpDate }
    : null;

  const attributesRow = getCharacterAttributesRow(characterId);
  const attributes = attributesRow
    ? {
        intelligence: attributesRow.intelligence,
        memory: attributesRow.memory,
        charisma: attributesRow.charisma,
        perception: attributesRow.perception,
        willpower: attributesRow.willpower,
        bonusRemaps: attributesRow.bonusRemaps,
        lastRemapDate: attributesRow.lastRemapDate,
        accruedRemapCooldownDate: attributesRow.accruedRemapCooldownDate,
      }
    : null;

  // Wallet is a late-added scope, so tokens from before it are common — classify
  // why the balance is absent instead of showing a bare empty state.
  const walletRow = getCharacterWalletRow(characterId);
  const walletStatus = classifyEsiDataStatus({
    tokenInvalid: getInvalidTokenIds().has(characterId),
    missingScopes: missingScopes(grantedScopes(characterId), [SCOPE_READ_WALLET]),
    hasSynced: walletRow !== null,
  });

  const cloneRows = getJumpClones(characterId);
  const cloneMeta = getCloneMeta(characterId);
  const cloneImplantNames = getTypeNames([...new Set(cloneRows.flatMap((c) => c.implants))]);
  const stationIds: number[] = [];
  const structureIds: number[] = [];
  const collect = (locationType: string | null, locationId: number | null): void => {
    if (locationId === null) return;
    if (locationType === 'station') stationIds.push(locationId);
    if (locationType === 'structure') structureIds.push(locationId);
  };
  for (const c of cloneRows) collect(c.locationType, c.locationId);
  if (cloneMeta) collect(cloneMeta.homeLocationType, cloneMeta.homeLocationId);
  const stationNames = await resolveStationNames(stationIds);
  const structureNames = getStructureNames(structureIds);
  const clones: JumpCloneEntry[] = cloneRows.map((clone) => ({
    jumpCloneId: clone.jumpCloneId,
    name: clone.name,
    locationId: clone.locationId,
    locationType: clone.locationType,
    locationName: locationDisplayName(
      clone.locationType,
      clone.locationId,
      stationNames,
      structureNames,
    ),
    implants: clone.implants.map((typeId) => ({
      typeId,
      typeName: cloneImplantNames.get(typeId) ?? null,
    })),
  }));

  const planProgress = listPlanProgressForCharacter(characterId);

  const lastCloneJumpAt = cloneMeta?.lastCloneJumpDate ?? null;
  const medicalClone =
    cloneMeta && cloneMeta.homeLocationId !== null
      ? {
          locationId: cloneMeta.homeLocationId,
          locationType: cloneMeta.homeLocationType,
          locationName: locationDisplayName(
            cloneMeta.homeLocationType,
            cloneMeta.homeLocationId,
            stationNames,
            structureNames,
          ),
        }
      : null;

  // Training-slot context: only one character per account can train (without
  // MCT), so an idle character is routine when a sibling is training and a
  // wasted slot when nobody on an Omega account is.
  let accountStatus: CharacterDetail['accountStatus'] = null;
  if (character.accountId !== null) {
    const account = getAccount(character.accountId);
    if (account) {
      const otherCharacterTraining = listCharacters().some(
        (c) =>
          c.accountId === character.accountId &&
          c.id !== characterId &&
          getTrainingStatus(c.id).isTraining,
      );
      accountStatus = { isOmega: account.isOmega, otherCharacterTraining };
    }
  }

  return {
    character,
    totalSp,
    skillQueue,
    skillGroups,
    location,
    ship,
    implants,
    jumpFatigue,
    attributes,
    wallet: walletRow ? { balance: walletRow.balance, updatedAt: walletRow.updatedAt } : null,
    walletStatus,
    clones,
    clonesUpdatedAt: cloneMeta?.updatedAt ?? null,
    medicalClone,
    lastCloneJumpAt,
    nextCloneJumpAt: nextCloneJumpDate(
      lastCloneJumpAt,
      getActiveSkillLevel(characterId, INFOMORPH_SYNCHRONIZING_TYPE_ID),
    ),
    groups: listGroupsForCharacter(characterId),
    tags: listTagsForCharacter(characterId),
    plans: planProgress.plans,
    plansNeedSkillData: planProgress.needsSkillData,
    isTraining: getTrainingStatus(characterId).isTraining,
    accountStatus,
  };
}
