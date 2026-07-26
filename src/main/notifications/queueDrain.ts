/** Warning window for an about-to-empty skill queue. */
export const WARNING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export interface QueueDrainCandidate {
  characterId: number;
  characterName: string;
  /** finishDate of the queue's head entry (position 0), or null if nothing is queued/training. */
  finishDate: string | null;
  /** Total entries in the queue. 1 = only the currently-training skill, nothing behind it. */
  queueLength: number;
  /** Head-of-queue skill id, carried through for notification text only — not part of the decision. */
  skillTypeId: number | null;
}

export interface QueueDrainWarning {
  characterId: number;
  characterName: string;
  finishDate: string;
  skillTypeId: number | null;
}

/** Characters whose queue will go empty within the warning window. */
export function findQueueDrainWarnings(
  candidates: QueueDrainCandidate[],
  now: number,
): QueueDrainWarning[] {
  const warnings: QueueDrainWarning[] = [];
  for (const c of candidates) {
    if (c.queueLength !== 1) continue;
    if (!c.finishDate) continue;
    const finishTime = new Date(c.finishDate).getTime();
    if (Number.isNaN(finishTime)) continue;
    const remaining = finishTime - now;
    if (remaining > 0 && remaining <= WARNING_WINDOW_MS) {
      warnings.push({
        characterId: c.characterId,
        characterName: c.characterName,
        finishDate: c.finishDate,
        skillTypeId: c.skillTypeId,
      });
    }
  }
  return warnings;
}
