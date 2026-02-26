import { z } from "zod";

// ---------------------------------------------------------------------------
// Queue names
// ---------------------------------------------------------------------------

export type QueueName =
  | "discovery"
  | "entry"
  | "confirmation"
  | "captcha"
  | "email-check"
  | "sms-verify"
  | "social-action"
  | "proxy-health"
  | "win-detection"
  | "notification"
  | "cleanup";

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

export type JobPriority = "critical" | "high" | "normal" | "low";

export const JOB_PRIORITY_VALUES: Record<JobPriority, number> = {
  critical: 1,
  high: 2,
  normal: 3,
  low: 4,
} as const;

// ---------------------------------------------------------------------------
// Job data -- discriminated union by queue
// ---------------------------------------------------------------------------

export interface DiscoveryJobData {
  queue: "discovery";
  sourceId: string;
  sourceName: string;
  sourceType: "crawler" | "rss" | "api" | "social";
  url: string;
  config: Record<string, unknown>;
}

export interface EntryJobData {
  queue: "entry";
  contestId: string;
  profileId: string;
  entryMethod: string;
  proxyId?: string;
  fingerprintId?: string;
  attemptNumber: number;
}

export interface ConfirmationJobData {
  queue: "confirmation";
  entryId: string;
  contestId: string;
  profileId: string;
  confirmationType: "email" | "sms" | "page-check";
}

export interface CaptchaJobData {
  queue: "captcha";
  entryId: string;
  captchaType: string;
  siteKey: string;
  pageUrl: string;
  provider?: string;
}

export interface EmailCheckJobData {
  queue: "email-check";
  emailAccountId: string;
  profileId: string;
  lookForContestId?: string;
}

export interface SmsVerifyJobData {
  queue: "sms-verify";
  entryId: string;
  smsNumberId: string;
  expectedPattern?: string;
  timeoutMs?: number;
}

export interface SocialActionJobData {
  queue: "social-action";
  entryId: string;
  socialAccountId: string;
  platform: string;
  actionType: string;
  target: string;
}

export interface ProxyHealthJobData {
  queue: "proxy-health";
  proxyId: string;
  host: string;
  port: number;
  protocol: string;
}

export interface WinDetectionJobData {
  queue: "win-detection";
  profileId: string;
  source: "email" | "page-check" | "api";
  emailAccountId?: string;
  contestId?: string;
}

export interface NotificationJobData {
  queue: "notification";
  type: "win" | "claim-deadline" | "error" | "daily-summary" | "system";
  channel: "email" | "discord" | "slack" | "push";
  recipientId: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface CleanupJobData {
  queue: "cleanup";
  task:
    | "expire-contests"
    | "purge-old-screenshots"
    | "rotate-fingerprints"
    | "archive-entries"
    | "reset-limits";
  olderThanDays?: number;
}

/**
 * Discriminated union of all job data types.
 * Use `job.queue` as the discriminant.
 */
export type JobData =
  | DiscoveryJobData
  | EntryJobData
  | ConfirmationJobData
  | CaptchaJobData
  | EmailCheckJobData
  | SmsVerifyJobData
  | SocialActionJobData
  | ProxyHealthJobData
  | WinDetectionJobData
  | NotificationJobData
  | CleanupJobData;

// ---------------------------------------------------------------------------
// Job result
// ---------------------------------------------------------------------------

export interface JobResult {
  success: boolean;
  queue: QueueName;
  jobId: string;
  durationMs: number;
  data: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Queue monitoring
// ---------------------------------------------------------------------------

export interface QueueStatus {
  name: QueueName;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export interface QueueMetrics {
  queues: QueueStatus[];
  totalJobs: number;
  totalCompleted: number;
  totalFailed: number;
  avgProcessingTimeMs: number;
  jobsPerMinute: number;
  oldestWaitingJob: string | null;
  uptimeMs: number;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const queueNameSchema = z.enum([
  "discovery",
  "entry",
  "confirmation",
  "captcha",
  "email-check",
  "sms-verify",
  "social-action",
  "proxy-health",
  "win-detection",
  "notification",
  "cleanup",
]);

export const jobPrioritySchema = z.enum(["critical", "high", "normal", "low"]);

export const entryJobDataSchema = z.object({
  queue: z.literal("entry"),
  contestId: z.string().min(1),
  profileId: z.string().min(1),
  entryMethod: z.string().min(1),
  proxyId: z.string().optional(),
  fingerprintId: z.string().optional(),
  attemptNumber: z.number().int().min(1),
});

export const notificationJobDataSchema = z.object({
  queue: z.literal("notification"),
  type: z.enum(["win", "claim-deadline", "error", "daily-summary", "system"]),
  channel: z.enum(["email", "discord", "slack", "push"]),
  recipientId: z.string().min(1),
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
