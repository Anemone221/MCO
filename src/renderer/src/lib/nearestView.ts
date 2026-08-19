import type { NearestCharacterEntry, NearestCloneOption } from '@shared/types';

/**
 * Which distance the nearest-to-a-system list is ranked by. Both are real
 * answers to "closest": gate jumps is how fast a cyno alt can *fly* there,
 * light years is whether a capital could jump to where it already sits.
 */
export type NearestMetric = 'jumps' | 'lightYears';

export const NEAREST_METRIC_LABELS: Record<NearestMetric, string> = {
  jumps: 'Gate jumps',
  lightYears: 'Light years',
};

/** Unmeasurable distances sort last whichever metric is chosen. */
function rank(value: number | null): number {
  return value ?? Infinity;
}

/**
 * The best way a character has of reaching the target: staying in its own body
 * and flying, or clone-jumping to one of its jump clones and starting from
 * there.
 */
export interface NearestRoute {
  /** Where the distances below are measured from. */
  via: 'location' | 'clone';
  /** The jump clone the distances came from; null when the character's own position won. */
  clone: NearestCloneOption | null;
  jumps: number | null;
  lightYears: number | null;
}

/**
 * Pick the route that gets a character closest by the chosen metric.
 *
 * Ties go to staying put: a clone jump costs the character its ship and its
 * cooldown, so it has to actually *beat* flying to be worth ranking on. When
 * the clone check is off, `entry.clones` is empty and this is always the
 * character's own position.
 */
export function bestRoute(entry: NearestCharacterEntry, metric: NearestMetric): NearestRoute {
  const distance = (route: { jumps: number | null; lightYears: number | null }): number =>
    rank(metric === 'jumps' ? route.jumps : route.lightYears);

  let best: NearestRoute = {
    via: 'location',
    clone: null,
    jumps: entry.jumps,
    lightYears: entry.lightYears,
  };
  for (const clone of entry.clones) {
    if (distance(clone) < distance(best)) {
      best = { via: 'clone', clone, jumps: clone.jumps, lightYears: clone.lightYears };
    }
  }
  return best;
}

/**
 * Rank entries by the chosen metric, nearest first, each measured by its best
 * route. Ties fall back to the other metric and then the name so the order is
 * total — a stable list matters when a background sync re-renders it under the
 * cursor.
 */
export function sortNearest(
  entries: NearestCharacterEntry[],
  metric: NearestMetric,
): NearestCharacterEntry[] {
  // Decorate, sort, undecorate: each entry carries its own route, so the sort
  // costs one `bestRoute` per entry without keying a lookup on anything the
  // entry might share with another row.
  const primary = (route: NearestRoute): number =>
    rank(metric === 'jumps' ? route.jumps : route.lightYears);
  const secondary = (route: NearestRoute): number =>
    rank(metric === 'jumps' ? route.lightYears : route.jumps);

  return entries
    .map((entry) => ({ entry, route: bestRoute(entry, metric) }))
    .sort(
      (a, b) =>
        primary(a.route) - primary(b.route) ||
        secondary(a.route) - secondary(b.route) ||
        a.entry.characterName.localeCompare(b.entry.characterName),
    )
    .map((ranked) => ranked.entry);
}

/**
 * Whether the character still owes time on its clone-jump cooldown — a clone
 * that beats every other route is a plan rather than an answer until this is
 * false. Null (never jumped) reads as ready, matching the Clones page.
 */
export function cloneJumpOnCooldown(readyAt: string | null, now = Date.now()): boolean {
  if (readyAt === null) return false;
  const ready = new Date(readyAt).getTime();
  return !Number.isNaN(ready) && ready > now;
}

/** Gate jumps as a cell value; "—" when no gate route reaches the target. */
export function formatJumps(jumps: number | null): string {
  return jumps === null ? '—' : String(jumps);
}

/**
 * Light years to two decimals below 10 and one above: jump ranges are quoted
 * to a tenth (a Jump Freighter's 10 ly, a Black Ops' 8), so near the limit the
 * second decimal is the difference between in range and stranded.
 */
export function formatLightYears(lightYears: number | null): string {
  if (lightYears === null) return '—';
  return `${lightYears.toFixed(lightYears < 10 ? 2 : 1)} ly`;
}

/** A clone's own name if it has one, else where it is, else its id. */
export function cloneLabel(clone: NearestCloneOption): string {
  return clone.name ?? clone.locationName ?? `Clone ${clone.jumpCloneId}`;
}
