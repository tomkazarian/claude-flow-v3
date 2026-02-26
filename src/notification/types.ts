/**
 * Type definitions for the notification module.
 * Shared across all notification channels and services.
 */

// ---------------------------------------------------------------------------
// Core notification types
// ---------------------------------------------------------------------------

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationType = 'win' | 'error' | 'info' | 'digest';

export interface AppNotification {
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  priority: NotificationPriority;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Channel interface
// ---------------------------------------------------------------------------

export interface NotificationChannel {
  readonly name: string;
  send(notification: AppNotification): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Win data
// ---------------------------------------------------------------------------

export interface WinData {
  winId: string;
  entryId: string;
  contestId: string;
  profileId: string;
  prizeDescription: string;
  prizeValue: number | null;
  claimDeadline: string | null;
  claimUrl: string | null;
  contestTitle: string;
  profileName: string;
}

// ---------------------------------------------------------------------------
// Error data
// ---------------------------------------------------------------------------

export interface ErrorData {
  code: string;
  message: string;
  module: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Digest data
// ---------------------------------------------------------------------------

export interface DigestData {
  period: {
    from: string;
    to: string;
    label: string;
  };
  stats: {
    totalEntries: number;
    successfulEntries: number;
    failedEntries: number;
    newContestsDiscovered: number;
    wins: number;
    totalCost: number;
  };
  topContests: Array<{
    contestId: string;
    title: string;
    entries: number;
    successRate: number;
  }>;
  recentWins: Array<{
    winId: string;
    contestTitle: string;
    prizeDescription: string;
    prizeValue: number | null;
    claimedAt: string;
  }>;
  upcomingDeadlines: Array<{
    contestId: string;
    title: string;
    endDate: string;
  }>;
  systemHealth: {
    activeBrowsers: number;
    activeProxies: number;
    queueSize: number;
    errorRate: number;
  };
}

// ---------------------------------------------------------------------------
// Routing rule
// ---------------------------------------------------------------------------

export interface RoutingRule {
  priority: NotificationPriority;
  channels: string[];
}

// ---------------------------------------------------------------------------
// Notification preferences (stored in app_settings)
// ---------------------------------------------------------------------------

export interface NotificationPreferences {
  enabled: boolean;
  webhookUrls: string[];
  emailRecipients: string[];
  smtpConfig?: SmtpConfig;
  routing: RoutingRule[];
  errorNotifications: boolean;
  digestSchedule: 'daily' | 'weekly' | 'both' | 'none';
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  webhookUrls: [],
  emailRecipients: [],
  routing: [
    { priority: 'urgent', channels: ['webhook', 'email'] },
    { priority: 'high', channels: ['webhook', 'email'] },
    { priority: 'normal', channels: ['webhook'] },
    { priority: 'low', channels: [] },
  ],
  errorNotifications: true,
  digestSchedule: 'daily',
};
