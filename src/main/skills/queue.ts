/**
 * Skill-queue trimming.
 *
 * ESI does not drop finished entries from `/characters/{id}/skillqueue`: a
 * skill that completed keeps its slot — original `queue_position`, past
 * `finish_date` — until the player next edits the queue. The in-game client
 * hides those entries, and so must we. Left in, the head of the stored queue is
 * a long-finished skill, which reads as "not training" everywhere the head
 * drives the training status, and the queue list shows a stack of "done" rows
 * above the skill actually in progress.
 *
 * Filtering happens on read rather than on sync so entries fall off as they
 * finish, instead of lingering until the next ESI poll.
 */

/** The date fields of a queue entry — all this module needs to classify one. */
export interface QueueTiming {
  finishDate: string | null;
}

/**
 * Whether an entry has already finished training. A paused queue carries no
 * dates at all (EVE clears them), and unstarted skills behind a paused head are
 * likewise dateless — neither is finished.
 */
export function isQueueEntryFinished(entry: QueueTiming, now: number = Date.now()): boolean {
  if (!entry.finishDate) return false;
  const finish = new Date(entry.finishDate).getTime();
  return !Number.isNaN(finish) && finish <= now;
}

/**
 * The part of a stored queue still left to train. ESI's ordering is preserved,
 * so index 0 is the skill training now (or the head of a paused queue), and
 * each entry keeps the `queue_position` ESI gave it.
 */
export function pendingQueue<T extends QueueTiming>(queue: T[], now: number = Date.now()): T[] {
  return queue.filter((entry) => !isQueueEntryFinished(entry, now));
}

/** A queue entry as far as {@link withFinishedQueue} needs it. */
export interface FinishedQueueEntry extends QueueTiming {
  skillTypeId: number;
  finishLevel: number;
}

/** A trained skill as the analysis engine reads it. */
export interface TrainedSkill {
  sp: number;
  trainedLevel: number;
}

/**
 * A character's trained skills with every finished queue entry applied.
 *
 * ESI's `/skills` lags the queue: a skill that finished training keeps its old
 * level there (often until the character next logs in or the queue is
 * touched), while the queue still carries the entry with a past
 * `finish_date`. The in-game client already counts that skill as trained, so
 * fit and plan analysis must too — otherwise a character who just finished a
 * skill reads as still missing it, no matter how often it is re-synced.
 *
 * `spForLevel(skillTypeId, level)` gives the total SP a skill holds at a
 * level; a raised skill's SP is lifted to at least that. Never lowers
 * anything, and returns a new map.
 */
export function withFinishedQueue<S extends TrainedSkill>(
  skills: Map<number, S>,
  queue: FinishedQueueEntry[],
  spForLevel: (skillTypeId: number, level: number) => number,
  now: number = Date.now(),
): Map<number, TrainedSkill> {
  const result = new Map<number, TrainedSkill>(skills);
  for (const entry of queue) {
    if (!isQueueEntryFinished(entry, now)) continue;
    const have = result.get(entry.skillTypeId);
    if (have && have.trainedLevel >= entry.finishLevel) continue;
    result.set(entry.skillTypeId, {
      trainedLevel: entry.finishLevel,
      sp: Math.max(have?.sp ?? 0, spForLevel(entry.skillTypeId, entry.finishLevel)),
    });
  }
  return result;
}
