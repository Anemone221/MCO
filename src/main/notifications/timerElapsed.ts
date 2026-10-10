/**
 * The rule behind the "a timer just ran out" notification kinds — jump fatigue
 * clearing, a clone-jump cooldown ending. Pure, so unit tests need no
 * Electron or DB.
 *
 * Unlike `queueDrain.ts`, which warns *before* a deadline, these fire *after*
 * one: the news is that the character is free again.
 */

/**
 * How long after a deadline passes it is still worth saying so.
 *
 * A deadline in the table stays in the past forever — `jump_fatigue_expire_date`
 * keeps its value until the next jump, and a clone-jump cooldown that ended in
 * March is still "elapsed" today. Without a window, the first sweep after this
 * shipped would announce every jump every character has ever made, which on a
 * 90+ roster is hundreds of toasts for nothing, and a week offline would greet
 * the user with a week of stale news.
 *
 * 24h rather than one sweep interval: the app is not always running, and a
 * fatigue that cleared while the laptop was shut overnight is still worth
 * hearing about in the morning. Past that, the Roster and Clones pages already
 * show the truth and an "it's ready" toast is noise.
 */
export const ELAPSED_GRACE_MS = 24 * 60 * 60 * 1000;

/** One character's timer, as the rule sees it. */
export interface TimerCandidate {
  characterId: number;
  characterName: string;
  /**
   * When the timer runs out, ISO. Null when the character has no such timer at
   * all (never jumped, data never synced) — nothing to announce, not a warning.
   */
  deadline: string | null;
}

export interface ElapsedTimer {
  characterId: number;
  characterName: string;
  /** The deadline that passed — non-null, unlike the candidate's. */
  deadline: string;
}

/**
 * Timers that ran out within the grace window.
 *
 * A deadline exactly equal to `now` counts as elapsed: the timer has run out,
 * and holding it back for a sweep would delay the news by an hour.
 */
export function findElapsedTimers(candidates: TimerCandidate[], now: number): ElapsedTimer[] {
  const elapsed: ElapsedTimer[] = [];
  for (const candidate of candidates) {
    if (!candidate.deadline) continue;
    const deadlineTime = new Date(candidate.deadline).getTime();
    if (Number.isNaN(deadlineTime)) continue;
    const since = now - deadlineTime;
    if (since >= 0 && since <= ELAPSED_GRACE_MS) {
      elapsed.push({
        characterId: candidate.characterId,
        characterName: candidate.characterName,
        deadline: candidate.deadline,
      });
    }
  }
  return elapsed;
}
