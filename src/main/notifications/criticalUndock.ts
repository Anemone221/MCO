/**
 * The rule behind the "undocked in a critical clone" warning. Pure, so unit
 * tests need no Electron or DB.
 *
 * The live tracker observes an online character every few seconds. Each
 * observation says docked or in space; an *exposure* is one stretch in space,
 * from the first in-space observation to the next docked one. The warning is
 * raised once per exposure — its start time is the occurrence the dedupe key
 * names — and is re-evaluated on every in-space observation rather than only on
 * the undock itself, because the implant read can lag the location read (clone
 * jump, then straight out of the station): the first tick in space may still
 * see the old pod, the next one the critical set.
 */

/** What the tracker remembers about one online character between observations. */
export interface ExposureState {
  docked: boolean;
  /** ISO time of the first in-space observation of the current exposure; null while docked. */
  exposureStart: string | null;
}

/**
 * Fold one observation into the character's state.
 *
 * `prev` is undefined for the first observation since the character came
 * online (or since the app started). A first observation already in space
 * starts an exposure too: the character may have undocked in the gap before
 * presence polling noticed it was online, and "you are in space in your
 * critical pod" is still the news.
 */
export function observeDocking(
  prev: ExposureState | undefined,
  docked: boolean,
  nowIso: string,
): ExposureState {
  if (docked) return { docked: true, exposureStart: null };
  if (prev && !prev.docked && prev.exposureStart !== null) return prev;
  return { docked: false, exposureStart: nowIso };
}
