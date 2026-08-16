import { IpcChannel } from '@shared/ipc';
import { listNotifications, markAllRead, markRead } from '../../db/repositories/notifications';
import { handle } from '../handle';

export function registerNotificationChannels(): void {
  handle(IpcChannel.notificationsList, () => listNotifications());
  handle(IpcChannel.notificationsMarkRead, (_event, id: number) => markRead(id));
  handle(IpcChannel.notificationsMarkAllRead, () => markAllRead());
}
