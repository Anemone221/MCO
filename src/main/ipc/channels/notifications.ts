import { IpcChannel } from '@shared/ipc';
import {
  dismissAllNotifications,
  dismissNotification,
  listNotifications,
  markAllRead,
  markRead,
} from '../../db/repositories/notifications';
import {
  getNotificationPreferences,
  setNotificationPreference,
} from '../../services/notificationPreferences';
import { handle } from '../handle';

export function registerNotificationChannels(): void {
  handle(IpcChannel.notificationsList, () => listNotifications());
  handle(IpcChannel.notificationsMarkRead, (_event, id: number) => markRead(id));
  handle(IpcChannel.notificationsMarkAllRead, () => markAllRead());
  handle(IpcChannel.notificationsDismiss, (_event, id: number) => dismissNotification(id));
  handle(IpcChannel.notificationsDismissAll, () => dismissAllNotifications());
  handle(IpcChannel.notificationsPreferences, () => getNotificationPreferences());
  handle(IpcChannel.notificationsSetPreference, (_event, kind: string, enabled: boolean) =>
    setNotificationPreference(kind, enabled),
  );
}
