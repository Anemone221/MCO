import type { NearestBoard, NearestCharacterEntry, NearestCloneOption } from '@shared/types';
import { INFOMORPH_SYNCHRONIZING_TYPE_ID, nextCloneJumpDate } from '../clones/jumpCooldown';
import {
  getAllCloneMeta,
  getAllJumpClones,
  type CloneMetaRow,
} from '../db/repositories/clones';
import { getSystemJumps, getSystemPositions, getSystems } from '../db/repositories/sde';
import { getActiveSkillLevels } from '../db/repositories/skills';
import { getStructures } from '../db/repositories/structures';
import { listTags } from '../db/repositories/tags';
import { UserFacingError } from '../errors';
import { buildAdjacency, jumpsFrom, lightYearsBetween } from '../map/routing';
import { resolveStations } from './cloneService';
import { buildLocationBoard } from './locationService';

/** Capability tag names for every tagged character, in tag-name order. */
function tagNamesByCharacter(): Map<number, string[]> {
  const byCharacter = new Map<number, string[]>();
  // listTags() is already name-ordered, so appending keeps each list ordered.
  for (const tag of listTags()) {
    for (const characterId of tag.characterIds) {
      const names = byCharacter.get(characterId);
      if (names === undefined) byCharacter.set(characterId, [tag.name]);
      else names.push(tag.name);
    }
  }
  return byCharacter;
}

/** A jump clone resolved to the solar system it sits in, before it is measured. */
interface CloneSite {
  jumpCloneId: number;
  name: string | null;
  locationName: string | null;
  systemId: number;
}

/**
 * Where every character's jump clones sit, as solar systems.
 *
 * ESI gives a clone a station or structure id, never a system, so both have to
 * be resolved: NPC stations through the public `/universe/stations` route
 * (served from the ESI cache after the first call), player structures from the
 * `structures` table sync fills. A clone whose structure has never been
 * resolved has no system to measure and is counted instead of guessed at.
 */
async function jumpCloneSites(): Promise<{
  byCharacter: Map<number, CloneSite[]>;
  unmeasured: number;
}> {
  const clonesByCharacter = getAllJumpClones();
  const stationIds: number[] = [];
  const structureIds: number[] = [];
  for (const clones of clonesByCharacter.values()) {
    for (const clone of clones) {
      if (clone.locationId === null) continue;
      if (clone.locationType === 'station') stationIds.push(clone.locationId);
      else if (clone.locationType === 'structure') structureIds.push(clone.locationId);
    }
  }

  const stations = await resolveStations(stationIds);
  const structures = getStructures(structureIds);

  const byCharacter = new Map<number, CloneSite[]>();
  let unmeasured = 0;

  for (const [characterId, clones] of clonesByCharacter) {
    const sites: CloneSite[] = [];
    for (const clone of clones) {
      const station =
        clone.locationType === 'station' && clone.locationId !== null
          ? stations.get(clone.locationId)
          : undefined;
      const structure =
        clone.locationType === 'structure' && clone.locationId !== null
          ? structures.get(clone.locationId)
          : undefined;
      const systemId = station?.system_id ?? structure?.solarSystemId ?? null;
      if (systemId === null) {
        unmeasured += 1;
        continue;
      }
      sites.push({
        jumpCloneId: clone.jumpCloneId,
        name: clone.name,
        locationName: station?.name ?? structure?.name ?? null,
        systemId,
      });
    }
    if (sites.length > 0) byCharacter.set(characterId, sites);
  }

  return { byCharacter, unmeasured };
}

/**
 * Rank every character by how far it is from one system — the "which cyno alt
 * is closest to X" question, and the same answer for any other capability the
 * user tags for.
 *
 * One breadth-first search from the *target* answers it for all ~90 characters
 * at once: gate distance is symmetric, so searching outward from the system
 * costs one traversal instead of one per character. Jump clones ride along on
 * the same search — they are just more positions to look up in its result.
 *
 * With `includeJumpClones`, each character's clones are measured too: a
 * character with a clone two jumps out can be on grid long before one that has
 * to fly thirty. It is opt-in because resolving clone locations to systems
 * costs ESI station lookups the plain board never needs. Ranking by the better
 * of the two is the *caller's* job — `entry.jumps` stays "from where this
 * character is", and the clones come alongside it.
 *
 * Characters MCO has never had a location for are counted, not listed — a row
 * saying "unknown" ranked among real distances would be noise on a board whose
 * whole purpose is ordering.
 */
export async function buildNearestBoard(
  solarSystemId: number,
  includeJumpClones = false,
): Promise<NearestBoard> {
  const target = getSystems([solarSystemId]).get(solarSystemId);
  if (target === undefined) {
    throw new UserFacingError(
      'That solar system is not in the imported static data. Re-import it from the banner at the top of the page.',
    );
  }

  const board = await buildLocationBoard();
  const located = board.filter((entry) => entry.systemId !== null);

  const edges = getSystemJumps();
  const jumps = jumpsFrom(buildAdjacency(edges), solarSystemId);

  const clones = includeJumpClones
    ? await jumpCloneSites()
    : { byCharacter: new Map<number, CloneSite[]>(), unmeasured: 0 };
  const cloneSystemIds = [...clones.byCharacter.values()].flat().map((site) => site.systemId);

  const measuredSystemIds = [
    ...new Set([solarSystemId, ...located.map((entry) => entry.systemId as number), ...cloneSystemIds]),
  ];
  const positions = getSystemPositions(measuredSystemIds);
  const targetPosition = positions.get(solarSystemId);
  const cloneSystems = getSystems([...new Set(cloneSystemIds)]);

  const lightYears = (systemId: number): number | null => {
    const from = positions.get(systemId);
    return targetPosition !== undefined && from !== undefined
      ? lightYearsBetween(from, targetPosition)
      : null;
  };

  const cloneMeta = includeJumpClones ? getAllCloneMeta() : new Map<number, CloneMetaRow>();
  const syncLevels = includeJumpClones
    ? getActiveSkillLevels(INFOMORPH_SYNCHRONIZING_TYPE_ID)
    : new Map<number, number>();
  const tagNames = tagNamesByCharacter();

  const entries: NearestCharacterEntry[] = located.map((entry) => {
    const systemId = entry.systemId as number;
    const cloneOptions: NearestCloneOption[] = (clones.byCharacter.get(entry.characterId) ?? [])
      .map((site) => {
        const system = cloneSystems.get(site.systemId);
        return {
          jumpCloneId: site.jumpCloneId,
          name: site.name,
          locationName: site.locationName,
          systemId: site.systemId,
          systemName: system?.name ?? null,
          security: system?.security ?? null,
          regionName: system?.regionName ?? null,
          jumps: jumps.get(site.systemId) ?? null,
          lightYears: lightYears(site.systemId),
        };
      })
      .sort(compareCloneOptions);

    return {
      ...entry,
      jumps: jumps.get(systemId) ?? null,
      lightYears: lightYears(systemId),
      tagNames: tagNames.get(entry.characterId) ?? [],
      clones: cloneOptions,
      cloneJumpReadyAt: includeJumpClones
        ? nextCloneJumpDate(
            cloneMeta.get(entry.characterId)?.lastCloneJumpDate ?? null,
            syncLevels.get(entry.characterId) ?? 0,
          )
        : null,
    };
  });

  return {
    target: {
      solarSystemId: target.id,
      name: target.name,
      security: target.security,
      regionName: target.regionName,
    },
    entries: entries.sort(compareByDistance),
    unlocatedCount: board.length - located.length,
    hasJumpData: edges.length > 0,
    includesJumpClones: includeJumpClones,
    unmeasuredClones: clones.unmeasured,
  };
}

/**
 * Distance between two unmeasurable values is NaN, which a comparator must
 * never return — treat it as "no difference" and let the next term decide.
 */
function byDistance(a: number | null, b: number | null): number {
  const diff = (a ?? Infinity) - (b ?? Infinity);
  return Number.isNaN(diff) ? 0 : diff;
}

/** Nearest clone first, so a caller taking the head of the list gets the best one. */
function compareCloneOptions(a: NearestCloneOption, b: NearestCloneOption): number {
  return (
    byDistance(a.jumps, b.jumps) ||
    byDistance(a.lightYears, b.lightYears) ||
    a.jumpCloneId - b.jumpCloneId
  );
}

/**
 * Nearest first, by where each character actually is — a caller that offers the
 * jump-clone check re-ranks with the clones folded in.
 *
 * Characters with no gate route to the target — wormhole space, and anywhere a
 * partial import left disconnected — sink below every routable one however few
 * light years away they are: the point of the ranking is who can *be there*,
 * and they cannot fly it.
 */
function compareByDistance(a: NearestCharacterEntry, b: NearestCharacterEntry): number {
  return (
    byDistance(a.jumps, b.jumps) ||
    byDistance(a.lightYears, b.lightYears) ||
    a.characterName.localeCompare(b.characterName)
  );
}
