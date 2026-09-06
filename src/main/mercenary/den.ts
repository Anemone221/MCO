import type { MercenaryDenStatus, MercenaryOperationStatus } from '@shared/types';

/**
 * Mercenary Den logic, kept dependency-free so it unit-tests without Electron,
 * a database or a network.
 *
 * Its whole job is turning what ESI says into what a user needs to decide
 * something. ESI reports a den as a string state plus two 0-100 meters wearing
 * string levels; none of that answers "which of my 90 characters needs me
 * today". These functions do.
 */

/** Highest level either evolution meter reaches (`Level4`). */
export const MAX_MERCENARY_LEVEL = 4;

/**
 * `Level3` -> 3, `Unspecified` -> null.
 *
 * Null is not zero. `Level0` is a real reading — a den with no anarchy at all —
 * whereas `Unspecified` is ESI declining to say, and the two must not render
 * the same way (see the "—" convention for absent values).
 */
export function mercenaryLevel(level: string | null | undefined): number | null {
  if (level === null || level === undefined) return null;
  const match = /^Level(\d+)$/.exec(level);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 0 && value <= MAX_MERCENARY_LEVEL ? value : null;
}

/**
 * What is actually going on at a den, as one word.
 *
 * ESI's `state` alone won't do: a reinforced den reads `Paused`, which is the
 * same word it uses for a den that is merely idle, and only the presence of a
 * reinforcement timer separates them. Reinforcement is the one state that is a
 * deadline, so it outranks the rest.
 */
export function denStatus(input: {
  state: string | null;
  reinforcementEnd: string | null;
  now?: Date;
}): MercenaryDenStatus {
  const now = input.now ?? new Date();
  if (isReinforced(input.reinforcementEnd, now)) return 'reinforced';
  switch (input.state) {
    case 'Running':
      return 'running';
    case 'Paused':
      return 'paused';
    case 'Disabled':
      return 'disabled';
    default:
      // Both `Unspecified` and a null (detail never landed) mean the same
      // thing to a reader: nothing is known about this den yet.
      return 'unknown';
  }
}

/**
 * Whether a reinforcement timer is still running.
 *
 * A timer whose end has passed is not reinforcement — ESI can keep serving the
 * expired timestamp from cache for the rest of the endpoint's cache window,
 * and treating that as "reinforced" would leave a den flagged long after it
 * came back out.
 */
export function isReinforced(reinforcementEnd: string | null, now: Date = new Date()): boolean {
  if (reinforcementEnd === null) return false;
  const end = Date.parse(reinforcementEnd);
  return !Number.isNaN(end) && end > now.getTime();
}

/**
 * What an operation offer amounts to right now.
 *
 * `expires` is checked against the clock rather than trusted from `state`: an
 * offer that ran out between sweeps still reads `Available` in stored data,
 * and showing a dead offer as actionable is worse than showing none.
 */
export function operationStatus(input: {
  state: string | null;
  expires: string | null;
  now?: Date;
}): MercenaryOperationStatus {
  const now = input.now ?? new Date();
  const expires = input.expires === null ? NaN : Date.parse(input.expires);
  const lapsed = !Number.isNaN(expires) && expires <= now.getTime();

  switch (input.state) {
    case 'Available':
      return lapsed ? 'expired' : 'available';
    case 'Started':
      // A started operation that ran out of clock is still the user's problem
      // — it is unfinished, not merely gone — so it keeps its own state.
      return 'started';
    case 'Completed':
      return 'completed';
    case 'Expired':
      return 'expired';
    case 'Removed':
      return 'removed';
    default:
      return lapsed ? 'expired' : 'unknown';
  }
}

/**
 * Operations still worth acting on: something to run, or something half-run.
 * Everything else is history the board doesn't need to carry.
 */
export function isOpenOperation(status: MercenaryOperationStatus): boolean {
  return status === 'available' || status === 'started';
}

/**
 * Anarchy level at or above which a den is called out.
 *
 * Anarchy climbs on its own and is only brought down by running the den's
 * operations; past the midpoint of the 0-4 scale it starts siphoning the
 * skyhook's workforce, which is the point at which leaving it alone costs
 * something. Below that it is just weather.
 */
export const ANARCHY_ALERT_LEVEL = 2;

/**
 * Whether a den wants the user to do something, and — for a page that has to
 * rank 90 characters' worth of them — how loudly.
 *
 * Ordered by how little time there is to react: a reinforcement is a timer
 * someone else set, a disabled den is earning nothing at all, and anarchy is a
 * slope that only steepens. A den doing its job scores zero and sorts to the
 * bottom, which is where the majority of a large roster's dens belong.
 */
export function denAttention(input: {
  status: MercenaryDenStatus;
  anarchyLevel: number | null;
  openOperations: number;
}): number {
  if (input.status === 'reinforced') return 4;
  if (input.status === 'disabled') return 3;
  if (input.anarchyLevel !== null && input.anarchyLevel >= ANARCHY_ALERT_LEVEL) return 2;
  // Offers expire unrun; an idle den with work waiting is the cheapest fix on
  // the board, so it earns a nudge rather than silence.
  if (input.openOperations > 0) return 1;
  return 0;
}
