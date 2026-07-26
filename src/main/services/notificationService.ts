import { Notification, type BrowserWindow } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { listCharacters } from '../db/repositories/characters';
import { getQueue } from '../db/repositories/skills';
import { getTypeNames } from '../db/repositories/sde';
import { createNotification, markRead } from '../db/repositories/notifications';
import { findQueueDrainWarnings, type QueueDrainCandidate } from '../notifications/queueDrain';

function formatRemaining(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${totalMinutes % 60}m`;
  return `in ${Math.max(totalMinutes, 1)}m`;
}

/** Check every character's skill queue for one about to run dry, notifying (OS toast + in-app) once per distinct occurrence. */
export function checkQueueDrainWarnings(
  getWindow: () => BrowserWindow | null,
  now = Date.now(),
): void {
  const candidates: QueueDrainCandidate[] = listCharacters().map((c) => {
    const queue = getQueue(c.id);
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

  for (const warning of warnings) {
    const skillName = warning.skillTypeId !== null ? (names.get(warning.skillTypeId) ?? null) : null;
    const remaining = formatRemaining(new Date(warning.finishDate).getTime() - now);
    const title = `${warning.characterName}: queue about to run dry`;
    const body = skillName
      ? `"${skillName}" finishes ${remaining} — nothing queued after it. Training will stop until you add more.`
      : `Current skill finishes ${remaining} — nothing queued after it. Training will stop until you add more.`;

    const created = createNotification({
      kind: 'queue-drain',
      dedupeKey: `queue-drain:${warning.characterId}:${warning.finishDate}`,
      characterId: warning.characterId,
      title,
      body,
    });
    if (!created) continue; // already recorded on a previous sweep/run — don't re-toast

    getWindow()?.webContents.send(IpcChannel.notificationsChanged);

    if (Notification.isSupported()) {
      const toast = new Notification({ title, body });
      toast.on('click', () => {
        markRead(created.id);
        getWindow()?.webContents.send(IpcChannel.notificationsChanged);
        getWindow()?.show();
        getWindow()?.focus();
      });
      toast.show();
    }
  }
}
