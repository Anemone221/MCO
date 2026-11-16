import type { CloneBoardEntry, ImplantInfo, JumpCloneEntry } from '@shared/types';
import { SCOPE_READ_CLONES, SCOPE_READ_IMPLANTS } from '../config';
import { grantedScopesByCharacter } from '../auth/token-store';
import { classifyEsiDataStatus, missingScopes } from '../auth/scopeStatus';
import { listCharacters } from '../db/repositories/characters';
import { listAccounts } from '../db/repositories/accounts';
import { getAllActiveImplants, getAllCloneMeta, getAllJumpClones } from '../db/repositories/clones';
import { getInvalidTokenIds } from '../db/repositories/tokens';
import { getActiveSkillLevels } from '../db/repositories/skills';
import { INFOMORPH_SYNCHRONIZING_TYPE_ID, nextCloneJumpDate } from '../clones/jumpCooldown';
import { findCriticalMatch, implantSetKey, parseImplantSetKey } from '../clones/criticalImplants';
import {
  addCriticalImplantSet,
  getAllCriticalImplantSets,
  removeCriticalImplantSet,
} from '../db/repositories/criticalImplants';
import { requireCharacter } from './characterSync';
import { getTypeNames } from '../db/repositories/sde';
import { getStructureNames } from '../db/repositories/structures';
import { getStation, type EsiStation } from '../esi/endpoints';

/**
 * Resolve NPC stations (name + solar system) for the given location ids.
 * Public ESI lookups, served from the esi_cache after the first call;
 * failures are absent from the map.
 */
export async function resolveStations(stationIds: number[]): Promise<Map<number, EsiStation>> {
  const unique = [...new Set(stationIds)];
  const settled = await Promise.allSettled(unique.map((id) => getStation(id)));
  const stations = new Map<number, EsiStation>();
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') stations.set(unique[index]!, outcome.value);
  });
  return stations;
}

/** Resolve NPC-station names for the given location ids. */
export async function resolveStationNames(stationIds: number[]): Promise<Map<number, string>> {
  const stations = await resolveStations(stationIds);
  return new Map([...stations].map(([id, station]) => [id, station.name]));
}

/**
 * Display name for a station/structure location: stations resolve via public
 * ESI, player-owned structures via the structures table (filled by sync).
 */
export function locationDisplayName(
  locationType: string | null,
  locationId: number | null,
  stationNames: Map<number, string>,
  structureNames: Map<number, string>,
): string | null {
  if (locationId === null) return null;
  if (locationType === 'station') return stationNames.get(locationId) ?? null;
  if (locationType === 'structure') return structureNames.get(locationId) ?? null;
  return null;
}

/** Critical implant-set keys for one character (see clones/criticalImplants.ts). */
export function criticalKeysFor(characterId: number): string[] {
  return (getAllCriticalImplantSets().get(characterId) ?? []).map((s) => s.implantKey);
}

/**
 * Mark or unmark an implant set as critical.
 *
 * Unmarking removes every critical set this pod is flagged by — the exact set
 * and any smaller set it contains — because matching is by containment
 * (`findCriticalMatch`): leaving a contained set behind would keep the pod
 * warning after the user switched it off.
 */
export function setCriticalImplantSet(
  characterId: number,
  implantTypeIds: number[],
  critical: boolean,
  label: string | null,
): void {
  requireCharacter(characterId);
  const key = implantSetKey(implantTypeIds);
  if (critical) {
    if (key === '') throw new Error('A clone with no implants cannot be marked critical');
    addCriticalImplantSet(characterId, key, label?.trim() || null);
    return;
  }
  const worn = new Set(implantTypeIds);
  for (const existing of criticalKeysFor(characterId)) {
    if (parseImplantSetKey(existing).every((id) => worn.has(id))) {
      removeCriticalImplantSet(characterId, existing);
    }
  }
}

/** Build the clone board: every character's active implants and jump clones. */
export async function buildCloneBoard(): Promise<CloneBoardEntry[]> {
  const characters = listCharacters();
  const accounts = new Map(listAccounts().map((a) => [a.id, a.label]));
  const activeImplants = getAllActiveImplants();
  const jumpClones = getAllJumpClones();
  const meta = getAllCloneMeta();

  const allImplantIds = [
    ...[...activeImplants.values()].flat(),
    ...[...jumpClones.values()].flat().flatMap((c) => c.implants),
  ];
  const implantNames = getTypeNames([...new Set(allImplantIds)]);

  const stationIds: number[] = [];
  const structureIds: number[] = [];
  const collect = (locationType: string | null, locationId: number | null): void => {
    if (locationId === null) return;
    if (locationType === 'station') stationIds.push(locationId);
    if (locationType === 'structure') structureIds.push(locationId);
  };
  for (const c of [...jumpClones.values()].flat()) collect(c.locationType, c.locationId);
  for (const m of meta.values()) collect(m.homeLocationType, m.homeLocationId);
  const stationNames = await resolveStationNames(stationIds);
  const structureNames = getStructureNames(structureIds);

  const toImplantInfo = (typeId: number): ImplantInfo => ({
    typeId,
    typeName: implantNames.get(typeId) ?? null,
  });

  const invalidTokens = getInvalidTokenIds();
  const CLONE_SCOPES = [SCOPE_READ_IMPLANTS, SCOPE_READ_CLONES];
  const syncLevels = getActiveSkillLevels(INFOMORPH_SYNCHRONIZING_TYPE_ID);
  const criticalSets = getAllCriticalImplantSets();
  const scopes = grantedScopesByCharacter();

  return characters.map((character) => {
    const m = meta.get(character.id);
    const missing = missingScopes(scopes.get(character.id) ?? [], CLONE_SCOPES);
    const status = classifyEsiDataStatus({
      tokenInvalid: invalidTokens.has(character.id),
      missingScopes: missing,
      hasSynced: m !== undefined,
    });

    const criticalKeys = (criticalSets.get(character.id) ?? []).map((s) => s.implantKey);
    const isCritical = (implants: number[]): boolean =>
      findCriticalMatch(implants, criticalKeys) !== null;
    const active = activeImplants.get(character.id) ?? [];

    const clones: JumpCloneEntry[] = (jumpClones.get(character.id) ?? []).map((clone) => ({
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
      implants: clone.implants.map(toImplantInfo),
      critical: isCritical(clone.implants),
    }));

    return {
      characterId: character.id,
      characterName: character.name,
      accountLabel:
        character.accountId !== null ? (accounts.get(character.accountId) ?? null) : null,
      status,
      missingScopes: missing,
      activeImplants: active.map(toImplantInfo),
      activeCritical: isCritical(active),
      clones,
      updatedAt: m?.updatedAt ?? null,
      nextCloneJumpAt: nextCloneJumpDate(m?.lastCloneJumpDate ?? null, syncLevels.get(character.id) ?? 0),
      medicalClone:
        m && m.homeLocationId !== null
          ? {
              locationId: m.homeLocationId,
              locationType: m.homeLocationType,
              locationName: locationDisplayName(
                m.homeLocationType,
                m.homeLocationId,
                stationNames,
                structureNames,
              ),
            }
          : null,
    };
  });
}
