import { listAccounts } from '../db/repositories/accounts';
import { listCharacters } from '../db/repositories/characters';
import { getQueue } from '../db/repositories/skills';
import { getTypeNames } from '../db/repositories/sde';
import { findIdleOmegaAccounts } from '../notifications/idleOmega';
import { findQueueDrainWarnings, type QueueDrainCandidate } from '../notifications/queueDrain';
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
 * Check every character's skill queue for one about to run dry, notifying (OS
 * toast + in-app) once per distinct occurrence.
 *
 * The three steps are the shape every notification kind takes: gather
 * candidates from the DB, hand them to a pure rule, turn what comes back into
 * sentences. Delivery — dedupe, toast, ping — belongs to
 * {@link deliverNotifications} and is not this function's business.
 */
export function checkQueueDrainWarnings(getWindow: GetWindow, now = Date.now()): void {
  const candidates: QueueDrainCandidate[] = listCharacters().map((c) => {
    // Finished entries linger in ESI's queue; only what is left to train counts
    // towards "nothing queued behind this skill".
    const queue = pendingQueue(getQueue(c.id), now);
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
  for (const character of listCharacters()) {
    const accountId = character.accountId;
    if (accountId === null) continue;
    characterCounts.set(accountId, (characterCounts.get(accountId) ?? 0) + 1);
    // Finished entries linger in ESI's queue and a paused queue's head carries
    // no finish date; neither is a character that is training.
    const head = pendingQueue(getQueue(character.id), now)[0] ?? null;
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
