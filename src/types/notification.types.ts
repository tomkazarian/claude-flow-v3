import { z } from "zod";

// ---------------------------------------------------------------------------
// String literal unions
// ---------------------------------------------------------------------------

export type NotificationType =
  | "win_detected"
  | "claim_deadline"
  | "claim_success"
  | "entry_failed"
  | "entry_confirmed"
  | "daily_summary"
  | "weekly_report"
  | "budget_warning"
  | "system_error"
  | "discovery_complete";

export type NotificationChannel =
  | "email"
  | "discord"
  | "slack"
  | "push"
  | "sms";

export type NotificationUrgency = "critical" | "high" | "normal" | "low";

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

export interface Notification {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  urgency: NotificationUrgency;
  recipientId: string;
  subject: string;
  body: string;
  htmlBody: string | null;

  /** Related entity references for deep-linking */
  relatedEntities: NotificationEntity[];

  /** Whether the notification has been read/acknowledged */
  read: boolean;

  /** Whether the notification was successfully delivered */
  delivered: boolean;

  /** Delivery error if not delivered */
  deliveryError: string | null;

  /** External message ID from the delivery provider */
  externalMessageId: string | null;

  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationEntity {
  entityType: "contest" | "entry" | "win" | "profile";
  entityId: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export interface NotificationPreferences {
  /** Global enable/disable */
  enabled: boolean;

  /** Channels to use for each notification type */
  channelMap: Partial<Record<NotificationType, NotificationChannel[]>>;

  /** Quiet hours (no notifications except critical) */
  quietHours: {
    enabled: boolean;
    startHour: number; // 0-23
    endHour: number; // 0-23
    timezone: string;
  };

  /** Minimum urgency to send during quiet hours */
  quietHoursMinUrgency: NotificationUrgency;

  /** Daily summary delivery time (hour 0-23) */
  dailySummaryHour: number;

  /** Whether to send weekly reports */
  weeklyReportEnabled: boolean;

  /** Day of week for weekly report (0=Sun, 6=Sat) */
  weeklyReportDay: number;

  /** Budget warning threshold as percentage (0-100) */
  budgetWarningThreshold: number;

  /** Discord webhook URL */
  discordWebhookUrl: string | null;

  /** Slack webhook URL */
  slackWebhookUrl: string | null;

  /** Push notification subscription (web push) */
  pushSubscription: PushSubscriptionData | null;
}

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const notificationTypeSchema = z.enum([
  "win_detected",
  "claim_deadline",
  "claim_success",
  "entry_failed",
  "entry_confirmed",
  "daily_summary",
  "weekly_report",
  "budget_warning",
  "system_error",
  "discovery_complete",
]);

export const notificationChannelSchema = z.enum([
  "email",
  "discord",
  "slack",
  "push",
  "sms",
]);

export const notificationUrgencySchema = z.enum([
  "critical",
  "high",
  "normal",
  "low",
]);

export const notificationEntitySchema = z.object({
  entityType: z.enum(["contest", "entry", "win", "profile"]),
  entityId: z.string().min(1),
  label: z.string().min(1),
});

export const pushSubscriptionDataSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const notificationPreferencesSchema = z.object({
  enabled: z.boolean(),
  channelMap: z.record(
    notificationTypeSchema,
    z.array(notificationChannelSchema),
  ).optional(),
  quietHours: z.object({
    enabled: z.boolean(),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
    timezone: z.string(),
  }),
  quietHoursMinUrgency: notificationUrgencySchema,
  dailySummaryHour: z.number().int().min(0).max(23),
  weeklyReportEnabled: z.boolean(),
  weeklyReportDay: z.number().int().min(0).max(6),
  budgetWarningThreshold: z.number().min(0).max(100),
  discordWebhookUrl: z.string().url().nullable(),
  slackWebhookUrl: z.string().url().nullable(),
  pushSubscription: pushSubscriptionDataSchema.nullable(),
});
