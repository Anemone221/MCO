/**
 * Critical implant sets — pods a character must not lose. Pure, so unit tests
 * need no Electron or DB.
 *
 * A set is identified by its implants, not by a jump-clone id: jumping into a
 * jump clone makes it the active clone and ESI drops it from the jump-clone
 * list, so an id-keyed flag would vanish the moment the pod is actually worn —
 * exactly when the warning matters.
 */

/** Canonical key for an implant set: sorted, de-duplicated type ids, comma-joined. */
export function implantSetKey(implantTypeIds: readonly number[]): string {
  return [...new Set(implantTypeIds)].sort((a, b) => a - b).join(',');
}

/** Inverse of {@link implantSetKey}. Unparseable fragments are dropped. */
export function parseImplantSetKey(key: string): number[] {
  if (key === '') return [];
  return key
    .split(',')
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * The critical set the active clone is wearing, if any: a set matches when
 * every one of its implants is plugged in. A superset still matches — plugging
 * one more implant into a pod does not make it any cheaper to lose. Empty sets
 * never match (there is nothing to protect). When several match, the largest
 * wins, so the warning names the most specific set.
 */
export function findCriticalMatch(
  activeImplants: readonly number[],
  criticalKeys: readonly string[],
): string | null {
  const active = new Set(activeImplants);
  let best: { key: string; size: number } | null = null;
  for (const key of criticalKeys) {
    const ids = parseImplantSetKey(key);
    if (ids.length === 0) continue;
    if (!ids.every((id) => active.has(id))) continue;
    if (best === null || ids.length > best.size) best = { key, size: ids.length };
  }
  return best?.key ?? null;
}
