import { listCharacters } from '../db/repositories/characters';
import { getQueue } from '../db/repositories/skills';
import { getTypeNames } from '../db/repositories/sde';
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
