/**
 * In-app notification channel.
 *
 * Persists every notification to the local SQLite `notifications` table so that
 * the frontend dashboard can display them. This channel works without any
 * external API keys and is the primary way users see notifications when
 * webhooks/email are not configured.
 */

import { eq, desc } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { notifications } from '../../db/schema.js';
import { generateId } from '../../shared/crypto.js';
import { getLogger } from '../../shared/logger.js';
import type { AppNotification, NotificationChannel } from '../types.js';

const log = getLogger('notification', { channel: 'in-app' });

export interface StoredNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: string;
  data: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export class InAppChannel implements NotificationChannel {
  readonly name = 'in-app';

  /**
   * Persists a notification to the notifications table.
   * Always succeeds (returns true) as long as the database is available.
   */
  async send(notification: AppNotification): Promise<boolean> {
    try {
      const db = getDb();

      db.insert(notifications)
        .values({
          id: generateId(),
          type: notification.type,
          title: notification.title,
          message: notification.message,
          priority: notification.priority,
          data: JSON.stringify(notification.data ?? {}),
          isRead: 0,
          createdAt: notification.timestamp ?? new Date().toISOString(),
        })
        .run();

      log.debug(
        { type: notification.type, priority: notification.priority },
        'In-app notification stored',
      );

      return true;
    } catch (error) {
      log.error(
        { err: error, type: notification.type },
        'Failed to store in-app notification',
      );
      return false;
    }
  }

  /**
   * Retrieves recent notifications, optionally filtered by read status.
   */
  getNotifications(
    options: { unreadOnly?: boolean; limit?: number } = {},
  ): StoredNotification[] {
    const { unreadOnly = false, limit = 50 } = options;

    try {
      const db = getDb();

      const baseQuery = unreadOnly
        ? db.select().from(notifications).where(eq(notifications.isRead, 0))
        : db.select().from(notifications);

      const rows = baseQuery
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .all();

      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        message: row.message,
        priority: row.priority,
        data: JSON.parse(row.data ?? '{}') as Record<string, unknown>,
        isRead: row.isRead === 1,
        readAt: row.readAt,
        createdAt: row.createdAt,
      }));
    } catch (error) {
      log.error({ err: error }, 'Failed to retrieve notifications');
      return [];
    }
  }

  /**
   * Returns the count of unread notifications.
   */
  getUnreadCount(): number {
    try {
      const db = getDb();
      const result = db
        .select()
        .from(notifications)
        .where(eq(notifications.isRead, 0))
        .all();

      return result.length;
    } catch (error) {
      log.error({ err: error }, 'Failed to count unread notifications');
      return 0;
    }
  }

  /**
   * Marks a notification as read.
   */
  markAsRead(notificationId: string): void {
    try {
      const db = getDb();

      db.update(notifications)
        .set({
          isRead: 1,
          readAt: new Date().toISOString(),
        })
        .where(eq(notifications.id, notificationId))
        .run();

      log.debug({ notificationId }, 'Notification marked as read');
    } catch (error) {
      log.error(
        { err: error, notificationId },
        'Failed to mark notification as read',
      );
    }
  }

  /**
   * Marks all notifications as read.
   */
  markAllAsRead(): void {
    try {
      const db = getDb();

      db.update(notifications)
        .set({
          isRead: 1,
          readAt: new Date().toISOString(),
        })
        .where(eq(notifications.isRead, 0))
        .run();

      log.debug('All notifications marked as read');
    } catch (error) {
      log.error({ err: error }, 'Failed to mark all notifications as read');
    }
  }
}
