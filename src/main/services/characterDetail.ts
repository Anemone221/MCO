import type { CharacterDetail, JumpCloneEntry } from '@shared/types';
import { SCOPE_READ_WALLET } from '../config';
import { grantedScopes } from '../auth/token-store';
import { classifyEsiDataStatus, missingScopes } from '../auth/scopeStatus';
import { getCharacter, listCharacters } from '../db/repositories/characters';
import { getAccount } from '../db/repositories/accounts';
import { getCharacterAttributesRow } from '../db/repositories/characterAttributes';
import { getCharacterFatigueRow } from '../db/repositories/characterFatigue';
import { getCharacterWalletRow } from '../db/repositories/characterWallet';
import { getActiveImplants, getCloneMeta, getJumpClones } from '../db/repositories/clones';
import { getCharacterLocationRow } from '../db/repositories/characterLocation';
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
import { getSkillQueue, getTrainingStatus } from './characterSync';
import { criticalKeysFor, locationDisplayName, resolveStationNames } from './cloneService';
import { findCriticalMatch } from '../clones/criticalImplants';
import { listPlanProgressForCharacter } from './planService';

/**
 * Assemble the character detail view, entirely from stored data.
 *
 * Location, ship and active implants come from the rows sync and live tracking
 * keep (`character_location`, `character_implants`) — not from live ESI. The
 * page used to fetch them on open, which put three authed requests (and often a
 * token refresh) on the critical path, queued behind whatever the hourly sweep
 * or the live-tracking presence check had in the rate limiter: tens of seconds
 * on a busy moment. Live tracking refreshes an online character every 20 s, so
 * the stored row is current where it matters; an offline character's is as old
 * as its last sync, which `locationUpdatedAt` reports.
 */
export async function buildCharacterDetail(characterId: number): Promise<CharacterDetail> {
  const character = getCharacter(characterId);
  if (!character) throw new Error(`Unknown character ${characterId}`);

  const skillQueue = getSkillQueue(characterId);
  const totalSp = getTotalSp(characterId);
  const skillGroups = getCharacterSkillGroupSp(characterId);

  const stored = getCharacterLocationRow(characterId);

  let location: CharacterDetail['location'] = null;
  const systemId = stored?.solarSystemId ?? null;
  if (systemId !== null) {
    location = {
      solarSystemId: systemId,
      solarSystemName: getSystems([systemId]).get(systemId)?.name ?? null,
    };
  }

  let ship: CharacterDetail['ship'] = null;
  const shipTypeId = stored?.shipTypeId ?? null;
  if (shipTypeId !== null) {
    ship = {
      typeId: shipTypeId,
      typeName: getTypeNames([shipTypeId]).get(shipTypeId) ?? null,
      name: stored?.shipName ?? '',
    };
  }

  const implantIds = getActiveImplants(characterId);
  const implantNames = getTypeNames(implantIds);
  const implants: CharacterDetail['implants'] = implantIds.map((typeId) => ({
    typeId,
    typeName: implantNames.get(typeId) ?? null,
  }));

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
  const criticalKeys = criticalKeysFor(characterId);
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
    critical: findCriticalMatch(clone.implants, criticalKeys) !== null,
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
    // SQLite's datetime('now') is UTC without a zone marker.
    locationUpdatedAt: stored ? `${stored.updatedAt.replace(' ', 'T')}Z` : null,
    implants,
    implantsCritical:
      findCriticalMatch(
        implants.map((i) => i.typeId),
        criticalKeys,
      ) !== null,
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
