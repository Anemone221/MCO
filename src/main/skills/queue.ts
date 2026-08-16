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
