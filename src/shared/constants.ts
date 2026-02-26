// ---------------------------------------------------------------------------
// Contest & Entry domain enums
// ---------------------------------------------------------------------------

export const CONTEST_TYPES = {
  SWEEPSTAKES: 'sweepstakes',
  GIVEAWAY: 'giveaway',
  INSTANT_WIN: 'instant_win',
  DAILY_ENTRY: 'daily_entry',
  SOCIAL_MEDIA: 'social_media',
  MAIL_IN: 'mail_in',
  PURCHASE: 'purchase',
  REFERRAL: 'referral',
} as const;

export type ContestType = (typeof CONTEST_TYPES)[keyof typeof CONTEST_TYPES];

export const ENTRY_METHODS = {
  FORM: 'form',
  EMAIL: 'email',
  SOCIAL_FOLLOW: 'social_follow',
  SOCIAL_SHARE: 'social_share',
  SOCIAL_LIKE: 'social_like',
  SOCIAL_COMMENT: 'social_comment',
  SOCIAL_RETWEET: 'social_retweet',
  REFERRAL_LINK: 'referral_link',
  VIDEO_WATCH: 'video_watch',
  SURVEY: 'survey',
  NEWSLETTER: 'newsletter',
  APP_DOWNLOAD: 'app_download',
} as const;

export type EntryMethod = (typeof ENTRY_METHODS)[keyof typeof ENTRY_METHODS];

export const ENTRY_STATUSES = {
  PENDING: 'pending',
  QUEUED: 'queued',
  IN_PROGRESS: 'in_progress',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  DUPLICATE: 'duplicate',
} as const;

export type EntryStatus = (typeof ENTRY_STATUSES)[keyof typeof ENTRY_STATUSES];

export const CONTEST_STATUSES = {
  DISCOVERED: 'discovered',
  ACTIVE: 'active',
  ENTERING: 'entering',
  ENTERED: 'entered',
  EXPIRED: 'expired',
  BLACKLISTED: 'blacklisted',
  ERROR: 'error',
} as const;

export type ContestStatus = (typeof CONTEST_STATUSES)[keyof typeof CONTEST_STATUSES];

// ---------------------------------------------------------------------------
// Queue names (BullMQ)
// ---------------------------------------------------------------------------

export const QUEUE_NAMES = {
  DISCOVERY: 'discovery',
  ENTRY: 'entry',
  EMAIL_VERIFY: 'email-verify',
  SMS_VERIFY: 'sms-verify',
  SOCIAL_ACTION: 'social-action',
  CAPTCHA: 'captcha',
  CLEANUP: 'cleanup',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ---------------------------------------------------------------------------
// Default operational limits
// ---------------------------------------------------------------------------

export const DEFAULT_LIMITS = {
  MAX_BROWSER_INSTANCES: 3,
  MAX_RETRIES: 3,
  ENTRY_TIMEOUT_MS: 120_000,
  CAPTCHA_TIMEOUT_MS: 120_000,
  PROXY_ROTATION_INTERVAL_MS: 300_000,
  PAGE_LOAD_TIMEOUT_MS: 30_000,
  EMAIL_POLL_INTERVAL_MS: 10_000,
  EMAIL_POLL_TIMEOUT_MS: 300_000,
  SMS_POLL_INTERVAL_MS: 5_000,
  SMS_POLL_TIMEOUT_MS: 180_000,
  MAX_ENTRIES_PER_HOUR: 30,
  MAX_ENTRIES_PER_DAY: 200,
  DISCOVERY_INTERVAL_MS: 3_600_000, // 1 hour
  CLEANUP_INTERVAL_MS: 86_400_000, // 24 hours
  SCREENSHOT_MAX_AGE_MS: 604_800_000, // 7 days
} as const;

// ---------------------------------------------------------------------------
// File-system paths
// ---------------------------------------------------------------------------

export const PATHS = {
  SCREENSHOTS: './data/screenshots',
  DATABASE: './data/sweepstakes.db',
  LOGS: './data/logs',
  TEMP: './data/temp',
  PROFILES: './data/profiles',
} as const;

// ---------------------------------------------------------------------------
// Realistic user-agent strings (Chrome, Firefox, Edge on Windows & macOS)
// ---------------------------------------------------------------------------

export const USER_AGENTS: readonly string[] = [
  // Chrome – Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  // Chrome – macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  // Firefox – Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  // Firefox – macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  // Edge – Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  // Edge – macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  // Chrome – Windows 11
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
] as const;
