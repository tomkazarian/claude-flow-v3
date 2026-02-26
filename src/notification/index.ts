/**
 * Notification module public API.
 */

export { NotificationManager } from './notification-manager.js';
export { WinNotifier } from './win-notifier.js';
export { DigestBuilder } from './digest-builder.js';
export {
  WebhookChannel,
  EmailAlertChannel,
  InAppChannel,
  type StoredNotification,
} from './channels/index.js';
export type {
  AppNotification,
  NotificationChannel,
  NotificationPriority,
  NotificationType,
  WinData,
  ErrorData,
  DigestData,
  RoutingRule,
  NotificationPreferences,
  SmtpConfig,
} from './types.js';
export { DEFAULT_NOTIFICATION_PREFERENCES } from './types.js';
