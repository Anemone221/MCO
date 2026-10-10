import { IpcChannel } from '@shared/ipc';
import {
  dismissAllNotifications,
  dismissNotification,
  listNotifications,
  markAllRead,
  markRead,
} from '../../db/repositories/notifications';
import { handle } from '../handle';

export function registerNotificationChannels(): void {
  handle(IpcChannel.notificationsList, () => listNotifications());
  handle(IpcChannel.notificationsMarkRead, (_event, id: number) => markRead(id));
  handle(IpcChannel.notificationsMarkAllRead, () => markAllRead());
  handle(IpcChannel.notificationsDismiss, (_event, id: number) => dismissNotification(id));
  handle(IpcChannel.notificationsDismissAll, () => dismissAllNotifications());
}
