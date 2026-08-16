import type {
  CloneLocation,
  GroupDetail,
  GroupMemberStatus,
  PodIgnoredEntry,
  PodViolation,
} from '@shared/types';
import { getGroup, listGroupPodIgnores } from '../db/repositories/groups';
import { listCharacters } from '../db/repositories/characters';
import { getFit } from '../db/repositories/fits';
import { getPlan } from '../db/repositories/plans';
import { getSdeStatus, getSystems } from '../db/repositories/sde';
import { getQueue } from '../db/repositories/skills';
import { pendingQueue } from '../skills/queue';
import { listTagsForCharacter } from '../db/repositories/tags';
import { getAllActiveImplants, getAllCloneMeta, getAllJumpClones } from '../db/repositories/clones';
import { listCharacterLocations } from '../db/repositories/characterLocation';
import { getStructures } from '../db/repositories/structures';
import { flagPodsOutsideWhitelist } from '../clones/podWhitelist';
import { buildRoster } from './characterSync';
import { fitObjectiveStatus } from './fitService';
import { planObjectiveStatus } from './planService';
import { locationDisplayName, resolveStations } from './cloneService';

/**
 * Assemble the group page view: every member's roster status (training, queue,
 * location, ship, SP, tags), their medical-clone location (compared against
 * the group's home station on the page), plus, when the group has a priority
 * fit/plan, each member's skill progress toward it — one analysis pass per
 * objective, not per member.
 */
export async function buildGroupDetail(groupId: number): Promise<GroupDetail> {
  const group = getGroup(groupId);
  if (!group) throw new Error(`Unknown group ${groupId}`);

  const memberIds = new Set(group.characterIds);
  const entries = buildRoster()
    .filter((e) => memberIds.has(e.character.id))
    .sort((a, b) => a.character.name.localeCompare(b.character.name));

  const fit = group.priorityFitId !== null ? getFit(group.priorityFitId) : null;
  const plan = group.priorityPlanId !== null ? getPlan(group.priorityPlanId) : null;
  const fitStatuses = fit ? fitObjectiveStatus(fit.id, group.characterIds) : null;
  const planStatuses = plan ? planObjectiveStatus(plan.id, group.characterIds) : null;

  // Pod whitelist: members' pods carrying implants are checked against the
  // group's allowed systems. Ignored pods are exempt but still shown on the
  // Ignored tab, so clone data is also needed when only ignores exist.
  const allowedSystemIds = new Set(group.podSystems.map((s) => s.solarSystemId));
  const podIgnores = listGroupPodIgnores(groupId);
  const podDataNeeded = allowedSystemIds.size > 0 || podIgnores.length > 0;
  const activeImplants = podDataNeeded ? getAllActiveImplants() : new Map<number, number[]>();
  const jumpClones = podDataNeeded ? getAllJumpClones() : new Map<number, never[]>();
  const currentLocations = podDataNeeded
    ? new Map(listCharacterLocations().map((row) => [row.characterId, row]))
    : new Map<number, never>();

  const ignoredCloneOf = (characterId: number, jumpCloneId: number) =>
    (jumpClones.get(characterId) ?? []).find((c) => c.jumpCloneId === jumpCloneId);

  // Station/structure locations to resolve: medical clones (names for the
  // member cards), members' implanted jump clones (whitelist check), and
  // ignored clones (Ignored tab — their owner may have left the group).
  // Stations resolve via public ESI (esi_cache-served after the first call),
  // structures via the shared structures table.
  const cloneMeta = getAllCloneMeta();
  const stationIds: number[] = [];
  const structureIds: number[] = [];
  const collect = (locationType: string | null, locationId: number | null): void => {
    if (locationId === null) return;
    if (locationType === 'station') stationIds.push(locationId);
    if (locationType === 'structure') structureIds.push(locationId);
  };
  for (const entry of entries) {
    const m = cloneMeta.get(entry.character.id);
    if (m) collect(m.homeLocationType, m.homeLocationId);
    if (allowedSystemIds.size > 0) {
      for (const clone of jumpClones.get(entry.character.id) ?? []) {
        if (clone.implants.length > 0) collect(clone.locationType, clone.locationId);
      }
    }
  }
  for (const ignore of podIgnores) {
    if (ignore.jumpCloneId === null) continue;
    const clone = ignoredCloneOf(ignore.characterId, ignore.jumpCloneId);
    if (clone) collect(clone.locationType, clone.locationId);
  }
  const stations = await resolveStations(stationIds);
  const structures = getStructures(structureIds);

  const stationNames = new Map([...stations].map(([id, s]) => [id, s.name]));
  const structureNames = new Map<number, string>();
  for (const [id, row] of structures) {
    if (row.name !== null) structureNames.set(id, row.name);
  }

  const medicalCloneOf = (characterId: number): CloneLocation | null => {
    const m = cloneMeta.get(characterId);
    if (!m || m.homeLocationId === null) return null;
    return {
      locationId: m.homeLocationId,
      locationType: m.homeLocationType,
      locationName: locationDisplayName(
        m.homeLocationType,
        m.homeLocationId,
        stationNames,
        structureNames,
      ),
    };
  };

  const members: GroupMemberStatus[] = entries.map((entry) => {
    const queue = pendingQueue(getQueue(entry.character.id));
    return {
      character: entry.character,
      accountLabel: entry.accountLabel,
      totalSp: entry.totalSp,
      training: entry.training,
      queueLength: queue.length,
      queueEndDate: queue.length > 0 ? queue[queue.length - 1]!.finishDate : null,
      systemName: entry.systemName,
      shipTypeName: entry.shipTypeName,
      tags: listTagsForCharacter(entry.character.id),
      medicalClone: medicalCloneOf(entry.character.id),
      fitStatus: fitStatuses?.get(entry.character.id) ?? null,
      planStatus: planStatuses?.get(entry.character.id) ?? null,
    };
  });

  // Pod-whitelist violations, in member order. The pure check flags each
  // implanted pod outside the allowed systems; here we attach display names.
  const systemOfLocation = (locationType: string | null, locationId: number | null): number | null => {
    if (locationId === null) return null;
    if (locationType === 'station') return stations.get(locationId)?.system_id ?? null;
    if (locationType === 'structure') return structures.get(locationId)?.solarSystemId ?? null;
    return null;
  };

  const podViolations: PodViolation[] = [];
  const podIgnored: PodIgnoredEntry[] = [];
  if (podDataNeeded) {
    const podKey = (characterId: number, jumpCloneId: number | null): string =>
      `${characterId}:${jumpCloneId ?? 'active'}`;
    const ignoredKeys = new Set(podIgnores.map((i) => podKey(i.characterId, i.jumpCloneId)));

    // Flag every implanted member pod outside the whitelist, then drop the
    // ones the user chose to ignore — those surface on the Ignored tab.
    const flagged =
      allowedSystemIds.size > 0
        ? entries.map((entry) => ({
            entry,
            flags: flagPodsOutsideWhitelist(
              {
                activeImplantCount: (activeImplants.get(entry.character.id) ?? []).length,
                activeSystemId: currentLocations.get(entry.character.id)?.solarSystemId ?? null,
                clones: (jumpClones.get(entry.character.id) ?? []).map((clone) => ({
                  jumpCloneId: clone.jumpCloneId,
                  name: clone.name,
                  locationId: clone.locationId,
                  locationType: clone.locationType,
                  implantCount: clone.implants.length,
                })),
              },
              allowedSystemIds,
              systemOfLocation,
            ).filter((flag) => !ignoredKeys.has(podKey(entry.character.id, flag.jumpCloneId))),
          }))
        : [];

    // Ignored entries are resolved even when compliant or stale, so the
    // exemption stays visible and can be lifted. Names come from the full
    // character list — the pod's owner may have left the group since.
    const characterNames = new Map(listCharacters().map((c) => [c.id, c.name]));
    const rawIgnored = podIgnores.map((ignore) => {
      const base = {
        characterId: ignore.characterId,
        characterName: characterNames.get(ignore.characterId) ?? `Character ${ignore.characterId}`,
        ignoredAt: ignore.ignoredAt,
      };
      if (ignore.jumpCloneId === null) {
        return {
          ...base,
          kind: 'active' as const,
          jumpCloneId: null,
          cloneName: null,
          implantCount: (activeImplants.get(ignore.characterId) ?? []).length,
          systemId: currentLocations.get(ignore.characterId)?.solarSystemId ?? null,
          locationId: null,
          locationName: null,
          exists: true,
        };
      }
      const clone = ignoredCloneOf(ignore.characterId, ignore.jumpCloneId);
      return {
        ...base,
        kind: 'jump-clone' as const,
        jumpCloneId: ignore.jumpCloneId,
        cloneName: clone?.name ?? null,
        implantCount: clone ? clone.implants.length : null,
        systemId: clone ? systemOfLocation(clone.locationType, clone.locationId) : null,
        locationId: clone?.locationId ?? null,
        locationName: clone
          ? locationDisplayName(clone.locationType, clone.locationId, stationNames, structureNames)
          : null,
        exists: clone !== undefined,
      };
    });

    const involvedSystemIds = new Set<number>();
    for (const { flags } of flagged) {
      for (const flag of flags) if (flag.systemId !== null) involvedSystemIds.add(flag.systemId);
    }
    for (const raw of rawIgnored) if (raw.systemId !== null) involvedSystemIds.add(raw.systemId);
    const systemNames = getSystems([...involvedSystemIds]);
    const nameOfSystem = (systemId: number | null): string | null =>
      systemId !== null ? (systemNames.get(systemId)?.name ?? null) : null;

    for (const { entry, flags } of flagged) {
      for (const flag of flags) {
        podViolations.push({
          characterId: entry.character.id,
          characterName: entry.character.name,
          kind: flag.kind,
          jumpCloneId: flag.jumpCloneId,
          cloneName: flag.cloneName,
          implantCount: flag.implantCount,
          systemId: flag.systemId,
          systemName: nameOfSystem(flag.systemId),
          locationId: flag.locationId,
          locationName: locationDisplayName(
            flag.locationType,
            flag.locationId,
            stationNames,
            structureNames,
          ),
        });
      }
    }

    podIgnored.push(
      ...rawIgnored
        .map((raw) => ({ ...raw, systemName: nameOfSystem(raw.systemId) }))
        .sort(
          (a, b) =>
            a.characterName.localeCompare(b.characterName) ||
            (a.jumpCloneId ?? 0) - (b.jumpCloneId ?? 0),
        ),
    );
  }

  return {
    group,
    priorityFit: fit ? { id: fit.id, name: fit.name, shipName: fit.shipName } : null,
    priorityPlan: plan ? { id: plan.id, name: plan.name } : null,
    needsSkillData: (fit !== null || plan !== null) && !getSdeStatus().hasSkillData,
    members,
    podViolations,
    podIgnored,
  };
}
