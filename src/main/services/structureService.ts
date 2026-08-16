import type { StructureImportProgress, StructureSearchResult } from '@shared/types';
import type { StructureImportSummary } from '@shared/ipc';
import { SCOPE_READ_STRUCTURES } from '../config';
import { hasGrantedScope } from '../auth/token-store';
import { listCharacters } from '../db/repositories/characters';
import { getInvalidTokenIds } from '../db/repositories/tokens';
import { getPublicStructureIds, getStructure } from '../esi/endpoints';
import {
  getStructures,
  markStructureFailed,
  searchStructuresByName,
  upsertStructure,
} from '../db/repositories/structures';
import { getSystems } from '../db/repositories/sde';
import { UserFacingError } from '../errors';
import { isStructureDue } from '../structures/refreshPolicy';

/**
 * Name-search over already-imported structures for the group home-station
 * picker; hits carry their solar-system name for disambiguation (many
 * structures share names like "1-1I53 - Fort Knocks").
 */
export function searchStructures(query: string): StructureSearchResult[] {
  const rows = searchStructuresByName(query);
  const systems = getSystems([
    ...new Set(rows.flatMap((r) => (r.solarSystemId !== null ? [r.solarSystemId] : []))),
  ]);
  return rows.flatMap((row) =>
    row.name !== null
      ? [
          {
            structureId: row.structureId,
            name: row.name,
            systemName:
              row.solarSystemId !== null
                ? (systems.get(row.solarSystemId)?.name ?? null)
                : null,
          },
        ]
      : [],
  );
}

/**
 * Structure ids currently being fetched. A full sweep syncs many characters in
 * parallel and several of them often sit in the same citadel — the first fetch
 * to reach a structure wins, the rest skip it.
 */
const inFlight = new Set<number>();

/**
 * Any character whose live token grants the structures scope. Public
 * structures have open ACLs, so a single scoped character can resolve all of
 * them — no need for every token to carry the scope.
 */
function pickStructureScopedCharacter(): number | null {
  const invalid = getInvalidTokenIds();
  for (const c of listCharacters()) {
    if (!invalid.has(c.id) && hasGrantedScope(c.id, SCOPE_READ_STRUCTURES)) return c.id;
  }
  return null;
}

/** Fetch one structure via ESI and record the outcome. Never throws. */
async function fetchAndStore(
  structureId: number,
  characterId: number,
): Promise<'resolved' | 'failed' | 'skipped'> {
  if (inFlight.has(structureId)) return 'skipped';
  inFlight.add(structureId);
  try {
    const structure = await getStructure(structureId, characterId);
    upsertStructure({
      structureId,
      name: structure.name,
      solarSystemId: structure.solar_system_id,
      typeId: structure.type_id ?? null,
      ownerId: structure.owner_id,
    });
    return 'resolved';
  } catch (err) {
    markStructureFailed(structureId);
    console.warn(`Structure ${structureId} resolution failed via character ${characterId}:`, err);
    return 'failed';
  } finally {
    inFlight.delete(structureId);
  }
}

/**
 * Resolve player-owned structures into the shared `structures` table.
 * Best-effort: ids that are fresh, already being fetched, or inaccessible
 * (403 — not on the ACL) are skipped or stamped failed; nothing here throws.
 *
 * Called from character sync with the structure ids that character references
 * (docked location, jump clones, medical clone). The referencing character's
 * token is preferred — it's the one most likely to be on the ACL — but when it
 * lacks the scope (tokens predating it), any scoped character is used instead
 * so public and shared-access structures still resolve.
 */
export async function resolveStructures(
  characterId: number,
  structureIds: number[],
): Promise<void> {
  if (structureIds.length === 0) return;
  const viaCharacter = hasGrantedScope(characterId, SCOPE_READ_STRUCTURES)
    ? characterId
    : pickStructureScopedCharacter();
  if (viaCharacter === null) return;

  const unique = [...new Set(structureIds)];
  const known = getStructures(unique);
  const due = unique.filter((id) => isStructureDue(known.get(id)));
  await Promise.all(due.map((id) => fetchAndStore(id, viaCharacter)));
}

/** Batch size per Promise.all wave; the ESI client caps global concurrency anyway. */
const IMPORT_CHUNK = 40;

/**
 * Bulk-import every public structure: fetch the id list from the public
 * `/universe/structures` route, then resolve each unknown/stale id through a
 * scoped character. ~900 structures on Tranquility — under a minute at the
 * client's concurrency cap, and successes don't touch the ESI error limit.
 */
export async function importPublicStructures(
  onProgress: (progress: StructureImportProgress) => void,
): Promise<StructureImportSummary> {
  const characterId = pickStructureScopedCharacter();
  if (characterId === null) {
    throw new UserFacingError(
      `No character grants ${SCOPE_READ_STRUCTURES}. Re-add one character to enable structure import.`,
    );
  }

  const ids = await getPublicStructureIds();
  const known = getStructures(ids);
  const due = ids.filter((id) => isStructureDue(known.get(id)));

  let resolved = 0;
  let failed = 0;
  onProgress({ done: 0, total: due.length });
  for (let i = 0; i < due.length; i += IMPORT_CHUNK) {
    const chunk = due.slice(i, i + IMPORT_CHUNK);
    const outcomes = await Promise.all(chunk.map((id) => fetchAndStore(id, characterId)));
    for (const outcome of outcomes) {
      if (outcome === 'resolved') resolved += 1;
      if (outcome === 'failed') failed += 1;
    }
    onProgress({ done: Math.min(i + IMPORT_CHUNK, due.length), total: due.length });
  }
  return { totalPublic: ids.length, resolved, failed };
}
