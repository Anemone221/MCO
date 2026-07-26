/**
 * True when a member's medical clone is verifiably somewhere other than the
 * group's home station. False (no flag) when the group has no home station or
 * the clone's location hasn't synced yet — missing data is not an alarm.
 * Only the medical clone counts; where the character currently is doesn't.
 */
export function medicalCloneMismatch(
  homeStationId: number | null,
  medicalClone: { locationId: number } | null,
): boolean {
  return homeStationId !== null && medicalClone !== null && medicalClone.locationId !== homeStationId;
}

const POD_COLLAPSE_KEY = 'mco.podLocations.collapsed';

/**
 * Whether the Pod locations section is collapsed for this group. Persisted
 * per group in localStorage; missing or corrupt storage means expanded.
 */
export function loadPodSectionCollapsed(groupId: number): boolean {
  try {
    const raw = localStorage.getItem(POD_COLLAPSE_KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw) as Record<string, unknown>;
    return stored[String(groupId)] === true;
  } catch {
    return false;
  }
}

export function savePodSectionCollapsed(groupId: number, collapsed: boolean): void {
  try {
    const raw = localStorage.getItem(POD_COLLAPSE_KEY);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (collapsed) stored[String(groupId)] = true;
    else delete stored[String(groupId)];
    localStorage.setItem(POD_COLLAPSE_KEY, JSON.stringify(stored));
  } catch {
    // Persistence is best-effort; ignore quota/availability failures.
  }
}

/** Display classification of a member's skill queue on the group page. */
export type QueueSummary =
  | { state: 'empty' }
  | { state: 'paused'; queued: number }
  | { state: 'finished'; queued: number }
  | { state: 'active'; queued: number; endDate: string };

/**
 * Classify a skill queue for display. `queueEndDate` is the finish date of the
 * last queue entry; EVE clears queue dates while training is paused, so a
 * non-empty queue without one is paused. A queue whose end date has passed
 * ran dry and is finished.
 */
export function summarizeQueue(
  queueLength: number,
  queueEndDate: string | null,
  now: number = Date.now(),
): QueueSummary {
  if (queueLength <= 0) return { state: 'empty' };
  if (queueEndDate === null) return { state: 'paused', queued: queueLength };
  const end = new Date(queueEndDate).getTime();
  if (Number.isNaN(end) || end <= now) return { state: 'finished', queued: queueLength };
  return { state: 'active', queued: queueLength, endDate: queueEndDate };
}
