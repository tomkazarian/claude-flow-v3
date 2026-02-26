/**
 * Central notification router. Routes notifications to configured channels
 * based on priority and user preferences stored in app_settings.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { appSettings } from '../db/schema.js';
import { getLogger } from '../shared/logger.js';
import { eventBus } from '../shared/events.js';
import type {
  AppNotification,
  DigestData,
  ErrorData,
  NotificationChannel,
  NotificationPreferences,
  WinData,
} from './types.js';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './types.js';

const log = getLogger('notification');

const SETTINGS_KEY = 'notification_preferences';

export class NotificationManager {
  private preferences: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES;
  private channels: Map<string, NotificationChannel> = new Map();
  private initialized = false;

  /**
   * Registers a notification channel by name.
   */
  registerChannel(name: string, channel: NotificationChannel): void {
    this.channels.set(name, channel);
    log.info({ channel: name }, 'Notification channel registered');
  }

  /**
   * Loads notification preferences from app_settings table.
   * Falls back to defaults if no preferences are stored.
   */
  initialize(): void {
    try {
      const db = getDb();
      const row = db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, SETTINGS_KEY))
        .get();

      if (row) {
        const parsed = JSON.parse(row.value) as Partial<NotificationPreferences>;
        this.preferences = {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          ...parsed,
        };
        log.info('Notification preferences loaded from database');
      } else {
        this.preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
        log.info('Using default notification preferences');
      }

      this.initialized = true;
    } catch (error) {
      log.error({ err: error }, 'Failed to load notification preferences, using defaults');
      this.preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
      this.initialized = true;
    }
  }

  /**
   * Routes a notification to the appropriate channels based on priority.
   */
  async notify(notification: AppNotification): Promise<void> {
    if (!this.initialized) {
      this.initialize();
    }

    if (!this.preferences.enabled) {
      log.debug({ type: notification.type }, 'Notifications disabled, skipping');
      return;
    }

    const channelNames = this.getChannelsForPriority(notification.priority);

    // Always log regardless of channels
    this.logNotification(notification);

    if (channelNames.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      channelNames.map(async (name) => {
        const channel = this.channels.get(name);
        if (!channel) {
          log.warn({ channel: name }, 'Channel not registered, skipping');
          return false;
        }
        return channel.send(notification);
      }),
    );

    const failures = results.filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === false),
    );

    if (failures.length > 0) {
      log.warn(
        { failures: failures.length, total: channelNames.length, type: notification.type },
        'Some notification channels failed',
      );
    }
  }

  /**
   * Sends a high-priority win notification to ALL registered channels.
   */
  async notifyWin(win: WinData): Promise<void> {
    const prizeValueStr = win.prizeValue != null
      ? `$${win.prizeValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : 'Unknown value';

    const notification: AppNotification = {
      type: 'win',
      title: `WIN: ${win.prizeDescription}`,
      message: [
        `Prize: ${win.prizeDescription} (${prizeValueStr})`,
        `Contest: ${win.contestTitle}`,
        `Profile: ${win.profileName}`,
        win.claimDeadline ? `Claim by: ${win.claimDeadline}` : null,
        win.claimUrl ? `Claim URL: ${win.claimUrl}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      data: {
        winId: win.winId,
        entryId: win.entryId,
        contestId: win.contestId,
        profileId: win.profileId,
        prizeValue: win.prizeValue,
        claimDeadline: win.claimDeadline,
        claimUrl: win.claimUrl,
      },
      priority: 'urgent',
      timestamp: new Date().toISOString(),
    };

    // Send to ALL channels for wins, ignoring routing rules
    const sendPromises = Array.from(this.channels.entries()).map(
      async ([name, channel]) => {
        try {
          const success = await channel.send(notification);
          if (!success) {
            log.warn({ channel: name }, 'Win notification channel returned false');
          }
          return success;
        } catch (error) {
          log.error(
            { err: error, channel: name, winId: win.winId },
            'Failed to send win notification',
          );
          return false;
        }
      },
    );

    await Promise.allSettled(sendPromises);

    eventBus.emit('win:detected', {
      entryId: win.entryId,
      prizeValue: win.prizeValue ?? 0,
      prizeDescription: win.prizeDescription,
    });
  }

  /**
   * Sends an error notification if error notifications are enabled.
   */
  async notifyError(error: ErrorData): Promise<void> {
    if (!this.initialized) {
      this.initialize();
    }

    if (!this.preferences.errorNotifications) {
      log.debug({ code: error.code }, 'Error notifications disabled, skipping');
      return;
    }

    const notification: AppNotification = {
      type: 'error',
      title: `Error: ${error.code}`,
      message: `[${error.module}] ${error.message}`,
      data: {
        code: error.code,
        module: error.module,
        details: error.details,
      },
      priority: 'high',
      timestamp: error.timestamp,
    };

    await this.notify(notification);
  }

  /**
   * Sends a digest summary notification.
   */
  async notifyDigest(digest: DigestData): Promise<void> {
    const { stats, period } = digest;
    const winRate =
      stats.totalEntries > 0
        ? ((stats.wins / stats.totalEntries) * 100).toFixed(2)
        : '0.00';

    const notification: AppNotification = {
      type: 'digest',
      title: `${period.label} Digest`,
      message: [
        `Period: ${period.from} - ${period.to}`,
        `Entries: ${stats.successfulEntries}/${stats.totalEntries} successful`,
        `Wins: ${stats.wins} (${winRate}% win rate)`,
        `New contests: ${stats.newContestsDiscovered}`,
        `Total cost: $${stats.totalCost.toFixed(2)}`,
      ].join('\n'),
      data: {
        digest,
      },
      priority: 'normal',
      timestamp: new Date().toISOString(),
    };

    await this.notify(notification);
  }

  /**
   * Returns the channel names for a given priority based on routing rules.
   */
  private getChannelsForPriority(priority: AppNotification['priority']): string[] {
    const rule = this.preferences.routing.find((r) => r.priority === priority);
    return rule?.channels ?? [];
  }

  /**
   * Logs a notification at the appropriate log level.
   */
  private logNotification(notification: AppNotification): void {
    const logData = {
      type: notification.type,
      title: notification.title,
      priority: notification.priority,
    };

    switch (notification.priority) {
      case 'urgent':
        log.warn(logData, notification.message);
        break;
      case 'high':
        log.info(logData, notification.message);
        break;
      case 'normal':
        log.info(logData, notification.message);
        break;
      case 'low':
        log.debug(logData, notification.message);
        break;
    }
  }
}
