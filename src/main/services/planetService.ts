import { getPlanet } from '../esi/endpoints';
import { getPlanets, markPlanetFailed, upsertPlanet } from '../db/repositories/planets';

/**
 * Turning planet ids into addresses.
 *
 * The SDE import carries systems and regions but no planets, so a Mercenary
 * Den's only address — its planet id — has to come from ESI's public
 * `/universe/planets` route. This is the structure-resolution pattern
 * (`structureService.ts`) with the two things planets don't need removed:
 *
 *  - no token, the route is public, so there is no scoped-character to pick;
 *  - no refresh policy, because a planet is never renamed or moved. An id that
 *    resolved once is resolved for good, and only failures are retried.
 */

/** Planet ids currently being fetched, so a sweep of many characters fetches each once. */
const inFlight = new Set<number>();

/** How long to leave a failed lookup alone before trying it again. */
const FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;

/**
 * Milliseconds for a SQLite `datetime('now')` stamp.
 *
 * SQLite writes UTC in a format that omits the zone (`2026-08-28 00:03:11`),
 * and `Date.parse` reads a zone-less string like that as *local* time — which
 * would shift the backoff below by the user's UTC offset, in either direction.
 * Naming the zone costs one replace and removes the question.
 */
function sqliteUtcMs(stamp: string): number {
  return Date.parse(`${stamp.replace(' ', 'T')}Z`);
}

/** Fetch one planet and record the outcome. Never throws. */
async function fetchAndStore(planetId: number): Promise<void> {
  if (inFlight.has(planetId)) return;
  inFlight.add(planetId);
  try {
    const planet = await getPlanet(planetId);
    upsertPlanet({
      planetId,
      name: planet.name,
      solarSystemId: planet.system_id,
      typeId: planet.type_id,
    });
  } catch (err) {
    markPlanetFailed(planetId);
    console.warn(`Planet ${planetId} resolution failed:`, err);
  } finally {
    inFlight.delete(planetId);
  }
}

/**
 * Resolve planet ids into the shared `planets` table.
 *
 * Best-effort: an id that is already named, in flight, or inside its failure
 * backoff is skipped, and nothing here throws — an unresolvable planet costs
 * the board an address, not the sync.
 */
export async function resolvePlanets(planetIds: number[]): Promise<void> {
  if (planetIds.length === 0) return;
  const unique = [...new Set(planetIds)];
  const known = getPlanets(unique);
  const now = Date.now();

  const due = unique.filter((id) => {
    const row = known.get(id);
    // Already named: planets don't change, so there is nothing to refresh.
    if (row?.name != null) return false;
    if (row?.failedAt == null) return true;
    const failedAt = sqliteUtcMs(row.failedAt);
    return Number.isNaN(failedAt) || now - failedAt > FAILURE_BACKOFF_MS;
  });

  await Promise.all(due.map((id) => fetchAndStore(id)));
}
