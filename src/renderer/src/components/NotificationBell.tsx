import { useCallback, useEffect, useState } from 'react';
import type { AppNotification } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatDate } from '../lib/format';
import { BellIcon } from './icons';

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setNotifications(await mco.notifications.list());
  }, []);

  useEffect(() => {
    void load();
    return mco.notifications.onChanged(() => void load());
  }, [load]);

  const unreadCount = notifications.filter((n) => n.readAt === null).length;

  async function markRead(id: number): Promise<void> {
    await mco.notifications.markRead(id);
    await load();
  }

  async function markAllRead(): Promise<void> {
    await mco.notifications.markAllRead();
    await load();
  }

  return (
    <div className="notification-bell">
      <button
        type="button"
        className="notification-bell__button"
        onClick={() => setOpen((prev) => !prev)}
        data-testid="notification-bell-button"
      >
        <BellIcon size={16} />
        {unreadCount > 0 && (
          <span className="notification-bell__badge" data-testid="notification-bell-badge">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notification-bell__panel" data-testid="notification-bell-panel">
          <div className="notification-bell__panel-header">
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button type="button" onClick={() => void markAllRead()}>
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="muted">No notifications yet.</p>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={
                  n.readAt === null
                    ? 'notification-bell__item notification-bell__item--unread'
                    : 'notification-bell__item'
                }
                onClick={() => void markRead(n.id)}
                data-testid={`notification-item-${n.id}`}
              >
                <div className="notification-bell__item-title">{n.title}</div>
                <div className="notification-bell__item-body">{n.body}</div>
                <div className="notification-bell__item-time">{formatDate(n.createdAt)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
