// ---------------------------------------------------------------------------
// Central type re-exports
// ---------------------------------------------------------------------------

// Contest types
export type {
  Contest,
  ContestType,
  ContestStatus,
  EntryMethod,
  EntryFrequency,
  PrizeCategory,
  GeoRestrictions,
  SocialAction,
  ContestCreateInput,
  ContestUpdateInput,
  ContestFilter,
  ContestWithStats,
} from "./contest.types.js";

export {
  contestTypeSchema,
  contestStatusSchema,
  entryMethodSchema,
  entryFrequencySchema,
  prizeCategorySchema,
  geoRestrictionsSchema,
  socialActionSchema,
  contestCreateSchema,
  contestUpdateSchema,
  contestFilterSchema,
} from "./contest.types.js";

// Entry types
export type {
  Entry,
  EntryStatus,
  EntryCreateInput,
  EntryResult,
  EntryFilter,
  EntryStats,
  EntryWithContest,
} from "./entry.types.js";

export {
  entryStatusSchema,
  entryCreateSchema,
  entryFilterSchema,
} from "./entry.types.js";

// Profile types
export type {
  Profile,
  ProfileCreateInput,
  ProfileUpdateInput,
  SocialAccounts,
  Address,
} from "./profile.types.js";

export {
  addressSchema,
  socialAccountsSchema,
  profileCreateSchema,
  profileUpdateSchema,
} from "./profile.types.js";

// Proxy types
export type {
  Proxy,
  ProxyProvider,
  ProxyProtocol,
  ProxyType,
  ProxyHealthStatus,
  ProxyConfig,
} from "./proxy.types.js";

export {
  proxyProviderSchema,
  proxyProtocolSchema,
  proxyTypeSchema,
  proxyHealthStatusSchema,
  proxyConfigSchema,
} from "./proxy.types.js";

// Captcha types
export type {
  CaptchaType,
  CaptchaProvider,
  CaptchaSolveRequest,
  CaptchaSolveResult,
  CaptchaConfig,
} from "./captcha.types.js";

export {
  captchaTypeSchema,
  captchaProviderSchema,
  captchaSolveRequestSchema,
  captchaConfigSchema,
} from "./captcha.types.js";

// Queue types
export type {
  QueueName,
  JobPriority,
  JobData,
  DiscoveryJobData,
  EntryJobData,
  ConfirmationJobData,
  CaptchaJobData,
  EmailCheckJobData,
  SmsVerifyJobData,
  SocialActionJobData,
  ProxyHealthJobData,
  WinDetectionJobData,
  NotificationJobData,
  CleanupJobData,
  JobResult,
  QueueStatus,
  QueueMetrics,
} from "./queue.types.js";

export {
  JOB_PRIORITY_VALUES,
  queueNameSchema,
  jobPrioritySchema,
  entryJobDataSchema,
  notificationJobDataSchema,
} from "./queue.types.js";

// Browser types
export type {
  BrowserFingerprint,
  BrowserSession,
  BrowserConfig,
  StealthConfig,
  StealthEvasion,
} from "./browser.types.js";

export {
  browserConfigSchema,
  stealthConfigSchema,
} from "./browser.types.js";

// Notification types
export type {
  NotificationType,
  NotificationChannel,
  NotificationUrgency,
  Notification,
  NotificationEntity,
  NotificationPreferences,
  PushSubscriptionData,
} from "./notification.types.js";

export {
  notificationTypeSchema,
  notificationChannelSchema,
  notificationUrgencySchema,
  notificationEntitySchema,
  pushSubscriptionDataSchema,
  notificationPreferencesSchema,
} from "./notification.types.js";

// Analytics types
export type {
  DashboardStats,
  EntryAnalytics,
  CostBreakdown,
  WinSummary,
  PendingClaim,
  ROIData,
  TimeSeriesPoint,
} from "./analytics.types.js";
