import { listAccounts } from '../db/repositories/accounts';
import { listCharacters } from '../db/repositories/characters';
import { listCharacterFatigue } from '../db/repositories/characterFatigue';
import { getAllCloneMeta, getAllJumpClones } from '../db/repositories/clones';
import { getActiveSkillLevels, getAllQueues } from '../db/repositories/skills';
import { getTypeNames } from '../db/repositories/sde';
import { INFOMORPH_SYNCHRONIZING_TYPE_ID, nextCloneJumpDate } from '../clones/jumpCooldown';
import { findIdleOmegaAccounts } from '../notifications/idleOmega';
import { findQueueDrainWarnings, type QueueDrainCandidate } from '../notifications/queueDrain';
import { findElapsedTimers, type TimerCandidate } from '../notifications/timerElapsed';
import { pendingQueue } from '../skills/queue';
import { deliverNotifications, type GetWindow } from './notificationDelivery';

function formatRemaining(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${totalMinutes % 60}m`;
  return `in ${Math.max(totalMinutes, 1)}m`;
}

/**
 * The past-tense twin of {@link formatRemaining}, for a deadline that has
 * already passed. Never needs a day unit: nothing older than
 * `ELAPSED_GRACE_MS` (24h) reaches a sentence.
 */
function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return 'just now';
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 1) return `${totalMinutes}m ago`;
  return `${hours}h ${totalMinutes % 60}m ago`;
}

/** characterId → name, for joining a per-character table to its display name. */
function characterNames(): Map<number, string> {
  return new Map(listCharacters().map((c) => [c.id, c.name]));
}

/**
 * Check every character's skill queue for one about to run dry, notifying (OS
 * toast + in-app) once per distinct occurrence.
 *
 * The three steps are the shape every notification kind takes: gather
 * candidates from the DB, hand them to a pure rule, turn what comes back into
 * sentences. Delivery — dedupe, toast, ping — belongs to
 * {@link deliverNotifications} and is not this function's business.
 */
export function checkQueueDrainWarnings(getWindow: GetWindow, now = Date.now()): void {
  const queues = getAllQueues();
  const candidates: QueueDrainCandidate[] = listCharacters().map((c) => {
    // Finished entries linger in ESI's queue; only what is left to train counts
    // towards "nothing queued behind this skill".
    const queue = pendingQueue(queues.get(c.id) ?? [], now);
    const head = queue[0] ?? null;
    return {
      characterId: c.id,
      characterName: c.name,
      finishDate: head?.finishDate ?? null,
      queueLength: queue.length,
      skillTypeId: head?.skillTypeId ?? null,
    };
  });

  const warnings = findQueueDrainWarnings(candidates, now);
  if (warnings.length === 0) return;

  const names = getTypeNames(
    warnings.map((w) => w.skillTypeId).filter((id): id is number => id !== null),
  );

  deliverNotifications(
    warnings.map((warning) => {
      const skillName =
        warning.skillTypeId !== null ? (names.get(warning.skillTypeId) ?? null) : null;
      const remaining = formatRemaining(new Date(warning.finishDate).getTime() - now);
      return {
        kind: 'queue-drain',
        // The finish date, so a re-queued skill earns a fresh warning while a
        // repeated sweep over the same queue does not.
        dedupeKey: `queue-drain:${warning.characterId}:${warning.finishDate}`,
        characterId: warning.characterId,
        title: `${warning.characterName}: queue about to run dry`,
        body: skillName
          ? `"${skillName}" finishes ${remaining} — nothing queued after it. Training will stop until you add more.`
          : `Current skill finishes ${remaining} — nothing queued after it. Training will stop until you add more.`,
      };
    }),
    getWindow,
  );
}

/**
 * Check every Omega account for one whose characters are all idle, notifying
 * (OS toast + in-app) once per account per day for as long as it stays idle.
 *
 * Same three steps as {@link checkQueueDrainWarnings}: gather from the DB, hand
 * to the pure rule, turn what comes back into sentences.
 */
export function checkIdleOmegaAccounts(getWindow: GetWindow, now = Date.now()): void {
  const accounts = listAccounts();
  if (accounts.length === 0) return;

  const characterCounts = new Map<number, number>();
  const trainingCounts = new Map<number, number>();
  const queues = getAllQueues();
  for (const character of listCharacters()) {
    const accountId = character.accountId;
    if (accountId === null) continue;
    characterCounts.set(accountId, (characterCounts.get(accountId) ?? 0) + 1);
    // Finished entries linger in ESI's queue and a paused queue's head carries
    // no finish date; neither is a character that is training.
    const head = pendingQueue(queues.get(character.id) ?? [], now)[0] ?? null;
    if (head?.finishDate) trainingCounts.set(accountId, (trainingCounts.get(accountId) ?? 0) + 1);
  }

  const warnings = findIdleOmegaAccounts(
    accounts.map((account) => ({
      accountId: account.id,
      accountLabel: account.label,
      isOmega: account.isOmega,
      characterCount: characterCounts.get(account.id) ?? 0,
      trainingCount: trainingCounts.get(account.id) ?? 0,
    })),
  );
  if (warnings.length === 0) return;

  // Idleness has no end date to key on the way a queue's finishDate does, so
  // the occurrence is "this account was idle on this day": one warning per
  // account per day rather than one per hourly sweep.
  const day = new Date(now).toISOString().slice(0, 10);

  deliverNotifications(
    warnings.map((warning) => {
      const count = warning.characterCount;
      return {
        kind: 'omega-idle',
        dedupeKey: `omega-idle:${warning.accountId}:${day}`,
        // Account-level: no one character is at fault, so the bell row does not
        // belong to any of them.
        characterId: null,
        title: `${warning.accountLabel}: Omega account training nobody`,
        body: `None of the ${count} character${count === 1 ? '' : 's'} on "${warning.accountLabel}" is training a skill. Omega training time is going to waste.`,
      };
    }),
    getWindow,
  );
}

/**
 * Check every character whose jump fatigue has finished decaying, notifying
 * (OS toast + in-app) once per fatigue episode.
 *
 * Same three steps as the kinds above: gather from the DB, hand to the pure
 * rule ({@link findElapsedTimers}), turn what comes back into sentences. Only
 * characters whose token carries the fatigue scope have a row at all, so scope
 * gating needs no check here.
 */
export function checkFatigueCleared(getWindow: GetWindow, now = Date.now()): void {
  const names = characterNames();

  const candidates: TimerCandidate[] = listCharacterFatigue().flatMap((row) => {
    const characterName = names.get(row.characterId);
    if (characterName === undefined) return [];
    return [{ characterId: row.characterId, characterName, deadline: row.jumpFatigueExpireDate }];
  });

  const cleared = findElapsedTimers(candidates, now);
  if (cleared.length === 0) return;

  deliverNotifications(
    cleared.map((timer) => ({
      kind: 'fatigue-clear',
      // The expire date, which is ESI's own and only changes when the character
      // jumps again — i.e. it names the fatigue episode that just ended.
      dedupeKey: `fatigue-clear:${timer.characterId}:${timer.deadline}`,
      characterId: timer.characterId,
      title: `${timer.characterName}: jump fatigue cleared`,
      // The name leads the body as well as the title: a toast body, or a row in
      // the OS notification centre, is read on its own, and "fatigue cleared"
      // means nothing when the answer could be any of 90+ characters. Who, what
      // and when, and nothing more — a toast has room for about that much
      // before it truncates.
      body:
        `${timer.characterName} is clear of jump fatigue — it expired ` +
        `${formatElapsed(now - new Date(timer.deadline).getTime())}.`,
    })),
    getWindow,
  );
}

/**
 * Check every character whose clone-jump cooldown has run out, notifying (OS
 * toast + in-app) once per cooldown.
 *
 * Characters with no jump clones are skipped: the cooldown is real but there is
 * nowhere to jump, so "ready" would be noise on every alt that has none — the
 * same reasoning that keeps {@link checkIdleOmegaAccounts} off empty account
 * buckets.
 */
export function checkCloneJumpReady(getWindow: GetWindow, now = Date.now()): void {
  const names = characterNames();
  const meta = getAllCloneMeta();
  const jumpClones = getAllJumpClones();
  const infomorphLevels = getActiveSkillLevels(INFOMORPH_SYNCHRONIZING_TYPE_ID);

  // The jump each cooldown belongs to, kept for the dedupe key below.
  const lastJumps = new Map<number, string>();

  const candidates: TimerCandidate[] = [...meta].flatMap(([characterId, cloneMeta]) => {
    const characterName = names.get(characterId);
    if (characterName === undefined) return [];
    if ((jumpClones.get(characterId)?.length ?? 0) === 0) return [];
    // Never clone-jumped: no cooldown was ever started, so there is no "ready
    // again" moment to announce — the jump has been available all along.
    if (cloneMeta.lastCloneJumpDate === null) return [];
    lastJumps.set(characterId, cloneMeta.lastCloneJumpDate);
    return [
      {
        characterId,
        characterName,
        // Same math as the Roster and Clones pages, so the notification agrees
        // with the "JC ready" the user reads there.
        deadline: nextCloneJumpDate(
          cloneMeta.lastCloneJumpDate,
          infomorphLevels.get(characterId) ?? 0,
        ),
      },
    ];
  });

  const ready = findElapsedTimers(candidates, now);
  if (ready.length === 0) return;

  deliverNotifications(
    ready.map((timer) => ({
      kind: 'clone-jump-ready',
      // Keyed on the *jump*, not on the deadline: the deadline is derived from
      // Infomorph Synchronizing, so training a level mid-cooldown moves it
      // earlier and would earn a second notification for the same cooldown.
      dedupeKey: `clone-jump-ready:${timer.characterId}:${lastJumps.get(timer.characterId)!}`,
      characterId: timer.characterId,
      title: `${timer.characterName}: clone jump ready`,
      // Named in the body too, and no longer than it has to be — see
      // checkFatigueCleared above. How many clones the character has is on the
      // Clones page; a toast does not have the room to spend on it.
      body:
        `${timer.characterName} can clone-jump again — the cooldown ended ` +
        `${formatElapsed(now - new Date(timer.deadline).getTime())}.`,
    })),
    getWindow,
  );
}
