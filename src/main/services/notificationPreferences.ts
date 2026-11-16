import {
  NOTIFICATION_KINDS,
  isNotificationKind,
  type NotificationKind,
  type NotificationPreferences,
} from '@shared/notifications';
import { getFlag, setFlag } from '../db/repositories/appSettings';
import { UserFacingError } from '../errors';

/** app_settings key for one kind's switch; absent = on. */
const settingKey = (kind: NotificationKind): string => `notify:${kind}`;

/**
 * Whether a kind may be delivered. A kind that is not in
 * {@link NOTIFICATION_KINDS} has no switch and is always on — a new kind must
 * never be silently dropped because someone forgot to list it.
 */
export function isNotificationKindEnabled(kind: string): boolean {
  return isNotificationKind(kind) ? getFlag(settingKey(kind), true) : true;
}

export function getNotificationPreferences(): NotificationPreferences {
  return Object.fromEntries(
    NOTIFICATION_KINDS.map(({ kind }) => [kind, getFlag(settingKey(kind), true)]),
  ) as NotificationPreferences;
}

/** Persist one kind's switch; resolves to every kind's resulting state. */
export function setNotificationPreference(kind: string, enabled: boolean): NotificationPreferences {
  if (!isNotificationKind(kind)) throw new UserFacingError('Unknown notification type.');
  setFlag(settingKey(kind), enabled);
  return getNotificationPreferences();
}
