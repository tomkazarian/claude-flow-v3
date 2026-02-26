import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helper: current-timestamp default
// ---------------------------------------------------------------------------
const currentTimestamp = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------
export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(), // ULID
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  emailAliases: text("email_aliases").default("[]"), // JSON string[]
  phone: text("phone"),
  phoneProvider: text("phone_provider"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  country: text("country").default("US").notNull(),
  dateOfBirth: text("date_of_birth"), // ISO-8601 date
  gender: text("gender"),
  socialAccounts: text("social_accounts").default("{}"), // JSON Record<string, string>
  isActive: integer("is_active").default(1).notNull(),
  createdAt: text("created_at").default(currentTimestamp).notNull(),
  updatedAt: text("updated_at").default(currentTimestamp).notNull(),
});

// ---------------------------------------------------------------------------
// contests
// ---------------------------------------------------------------------------
export const contests = sqliteTable(
  "contests",
  {
    id: text("id").primaryKey(), // ULID
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    sponsor: text("sponsor"),
    description: text("description"),
    source: text("source"),
    sourceUrl: text("source_url"),
    type: text("type", {
      enum: [
        "sweepstakes",
        "raffle",
        "giveaway",
        "instant_win",
        "contest",
        "daily",
      ],
    }).notNull(),
    entryMethod: text("entry_method", {
      enum: ["form", "social", "email", "purchase", "multi"],
    }).notNull(),
    status: text("status", {
      enum: [
        "discovered",
        "queued",
        "active",
        "completed",
        "expired",
        "invalid",
        "blocked",
      ],
    })
      .default("discovered")
      .notNull(),
    startDate: text("start_date"),
    endDate: text("end_date"),
    entryFrequency: text("entry_frequency", {
      enum: ["once", "daily", "weekly", "unlimited"],
    }).default("once"),
    maxEntries: integer("max_entries"),
    prizeDescription: text("prize_description"),
    prizeValue: real("prize_value"),
    prizeCategory: text("prize_category"),
    ageRequirement: integer("age_requirement").default(18),
    geoRestrictions: text("geo_restrictions").default("{}"), // JSON
    requiresCaptcha: integer("requires_captcha").default(0),
    requiresEmailConfirm: integer("requires_email_confirm").default(0),
    requiresSmsVerify: integer("requires_sms_verify").default(0),
    requiresSocialAction: integer("requires_social_action").default(0),
    socialActions: text("social_actions").default("[]"), // JSON
    termsUrl: text("terms_url"),
    difficultyScore: real("difficulty_score"),
    legitimacyScore: real("legitimacy_score"),
    priorityScore: real("priority_score"),
    formMapping: text("form_mapping").default("{}"), // JSON
    screenshotPath: text("screenshot_path"),
    lastCheckedAt: text("last_checked_at"),
    metadata: text("metadata").default("{}"), // JSON
    createdAt: text("created_at").default(currentTimestamp).notNull(),
    updatedAt: text("updated_at").default(currentTimestamp).notNull(),
  },
  (table) => [
    uniqueIndex("idx_contests_external_id").on(table.externalId),
    uniqueIndex("idx_contests_url").on(table.url),
    index("idx_contests_status").on(table.status),
    index("idx_contests_type").on(table.type),
    index("idx_contests_end_date").on(table.endDate),
    index("idx_contests_priority").on(table.priorityScore),
  ],
);

// ---------------------------------------------------------------------------
// entries
// ---------------------------------------------------------------------------
export const entries = sqliteTable(
  "entries",
  {
    id: text("id").primaryKey(), // ULID
    contestId: text("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: [
        "pending",
        "submitted",
        "confirmed",
        "failed",
        "won",
        "lost",
        "expired",
        "duplicate",
      ],
    })
      .default("pending")
      .notNull(),
    attemptNumber: integer("attempt_number").default(1).notNull(),
    entryMethod: text("entry_method"),
    proxyUsed: text("proxy_used"),
    fingerprintId: text("fingerprint_id"),
    captchaSolved: integer("captcha_solved").default(0),
    captchaType: text("captcha_type"),
    captchaCost: real("captcha_cost"),
    emailConfirmed: integer("email_confirmed").default(0),
    smsVerified: integer("sms_verified").default(0),
    socialCompleted: integer("social_completed").default(0),
    screenshotPath: text("screenshot_path"),
    errorMessage: text("error_message"),
    errorScreenshot: text("error_screenshot"),
    durationMs: integer("duration_ms"),
    submittedAt: text("submitted_at"),
    confirmedAt: text("confirmed_at"),
    createdAt: text("created_at").default(currentTimestamp).notNull(),
    updatedAt: text("updated_at").default(currentTimestamp).notNull(),
  },
  (table) => [
    index("idx_entries_contest").on(table.contestId),
    index("idx_entries_profile").on(table.profileId),
    index("idx_entries_status").on(table.status),
    index("idx_entries_submitted").on(table.submittedAt),
  ],
);

// ---------------------------------------------------------------------------
// entry_limits
// ---------------------------------------------------------------------------
export const entryLimits = sqliteTable(
  "entry_limits",
  {
    id: text("id").primaryKey(), // ULID
    contestId: text("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    lastEntryAt: text("last_entry_at"),
    entryCount: integer("entry_count").default(0).notNull(),
    nextEligibleAt: text("next_eligible_at"),
  },
  (table) => [
    uniqueIndex("idx_entry_limits_contest_profile").on(
      table.contestId,
      table.profileId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// wins
// ---------------------------------------------------------------------------
export const wins = sqliteTable(
  "wins",
  {
    id: text("id").primaryKey(), // ULID
    entryId: text("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    contestId: text("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    prizeDescription: text("prize_description"),
    prizeValue: real("prize_value"),
    detectionSource: text("detection_source"),
    detectionEmailId: text("detection_email_id"),
    claimDeadline: text("claim_deadline"),
    claimStatus: text("claim_status", {
      enum: [
        "detected",
        "notified",
        "claiming",
        "claimed",
        "expired",
        "forfeited",
      ],
    })
      .default("detected")
      .notNull(),
    claimUrl: text("claim_url"),
    notes: text("notes"),
    taxReported: integer("tax_reported").default(0),
    createdAt: text("created_at").default(currentTimestamp).notNull(),
    updatedAt: text("updated_at").default(currentTimestamp).notNull(),
  },
  (table) => [
    index("idx_wins_profile").on(table.profileId),
    index("idx_wins_claim_status").on(table.claimStatus),
  ],
);

// ---------------------------------------------------------------------------
// proxies
// ---------------------------------------------------------------------------
export const proxies = sqliteTable(
  "proxies",
  {
    id: text("id").primaryKey(), // ULID
    provider: text("provider"),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    username: text("username"),
    password: text("password"),
    protocol: text("protocol", {
      enum: ["http", "https", "socks4", "socks5"],
    })
      .default("http")
      .notNull(),
    country: text("country"),
    state: text("state"),
    city: text("city"),
    type: text("type", {
      enum: ["residential", "datacenter", "mobile", "isp"],
    }),
    isActive: integer("is_active").default(1).notNull(),
    lastHealthCheck: text("last_health_check"),
    healthStatus: text("health_status", {
      enum: ["healthy", "degraded", "dead", "unknown"],
    })
      .default("unknown")
      .notNull(),
    successCount: integer("success_count").default(0).notNull(),
    failureCount: integer("failure_count").default(0).notNull(),
    avgLatencyMs: real("avg_latency_ms"),
    createdAt: text("created_at").default(currentTimestamp).notNull(),
  },
  (table) => [
    index("idx_proxies_active").on(table.isActive, table.healthStatus),
    index("idx_proxies_geo").on(table.country, table.state),
  ],
);

// ---------------------------------------------------------------------------
// browser_fingerprints
// ---------------------------------------------------------------------------
export const browserFingerprints = sqliteTable("browser_fingerprints", {
  id: text("id").primaryKey(), // ULID
  userAgent: text("user_agent").notNull(),
  viewportWidth: integer("viewport_width").notNull(),
  viewportHeight: integer("viewport_height").notNull(),
  screenWidth: integer("screen_width").notNull(),
  screenHeight: integer("screen_height").notNull(),
  colorDepth: integer("color_depth").default(24).notNull(),
  timezone: text("timezone").notNull(),
  language: text("language").default("en-US").notNull(),
  platform: text("platform").notNull(),
  webglVendor: text("webgl_vendor"),
  webglRenderer: text("webgl_renderer"),
  canvasHash: text("canvas_hash"),
  audioHash: text("audio_hash"),
  fonts: text("fonts").default("[]"), // JSON string[]
  plugins: text("plugins").default("[]"), // JSON string[]
  hardwareConcurrency: integer("hardware_concurrency"),
  deviceMemory: integer("device_memory"),
  touchSupport: integer("touch_support").default(0),
  usageCount: integer("usage_count").default(0).notNull(),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").default(currentTimestamp).notNull(),
});

// ---------------------------------------------------------------------------
// email_accounts
// ---------------------------------------------------------------------------
export const emailAccounts = sqliteTable("email_accounts", {
  id: text("id").primaryKey(), // ULID
  profileId: text("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  emailAddress: text("email_address").notNull().unique(),
  provider: text("provider", {
    enum: ["gmail", "outlook", "imap"],
  }).notNull(),
  oauthTokens: text("oauth_tokens"), // encrypted JSON
  imapConfig: text("imap_config"), // encrypted JSON
  isActive: integer("is_active").default(1).notNull(),
  lastSyncAt: text("last_sync_at"),
  createdAt: text("created_at").default(currentTimestamp).notNull(),
});

// ---------------------------------------------------------------------------
// sms_numbers
// ---------------------------------------------------------------------------
export const smsNumbers = sqliteTable("sms_numbers", {
  id: text("id").primaryKey(), // ULID
  profileId: text("profile_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull(),
  provider: text("provider").notNull(),
  providerSid: text("provider_sid"),
  isActive: integer("is_active").default(1).notNull(),
  lastMessageAt: text("last_message_at"),
  createdAt: text("created_at").default(currentTimestamp).notNull(),
});

// ---------------------------------------------------------------------------
// social_accounts
// ---------------------------------------------------------------------------
export const socialAccounts = sqliteTable(
  "social_accounts",
  {
    id: text("id").primaryKey(), // ULID
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    username: text("username").notNull(),
    oauthTokens: text("oauth_tokens"), // encrypted JSON
    isActive: integer("is_active").default(1).notNull(),
    rateLimitRemaining: integer("rate_limit_remaining"),
    rateLimitResetAt: text("rate_limit_reset_at"),
    createdAt: text("created_at").default(currentTimestamp).notNull(),
  },
  (table) => [
    uniqueIndex("idx_social_accounts_profile_platform").on(
      table.profileId,
      table.platform,
    ),
  ],
);

// ---------------------------------------------------------------------------
// discovery_sources
// ---------------------------------------------------------------------------
export const discoverySources = sqliteTable("discovery_sources", {
  id: text("id").primaryKey(), // ULID
  name: text("name").notNull().unique(),
  type: text("type", {
    enum: ["crawler", "rss", "api", "social"],
  }).notNull(),
  url: text("url"),
  config: text("config").default("{}"), // JSON
  isActive: integer("is_active").default(1).notNull(),
  lastRunAt: text("last_run_at"),
  contestsFound: integer("contests_found").default(0).notNull(),
  errorCount: integer("error_count").default(0).notNull(),
  schedule: text("schedule"), // cron expression e.g. "0 */6 * * *"
  createdAt: text("created_at").default(currentTimestamp).notNull(),
});

// ---------------------------------------------------------------------------
// cost_log
// ---------------------------------------------------------------------------
export const costLog = sqliteTable(
  "cost_log",
  {
    id: text("id").primaryKey(), // ULID
    category: text("category", {
      enum: ["captcha", "proxy", "sms", "social"],
    }).notNull(),
    provider: text("provider").notNull(),
    amount: real("amount").notNull(),
    currency: text("currency").default("USD").notNull(),
    entryId: text("entry_id").references(() => entries.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    createdAt: text("created_at").default(currentTimestamp).notNull(),
  },
  (table) => [index("idx_cost_log_category").on(table.category)],
);

// ---------------------------------------------------------------------------
// app_settings
// ---------------------------------------------------------------------------
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON-encoded value
  updatedAt: text("updated_at").default(currentTimestamp).notNull(),
});

// ---------------------------------------------------------------------------
// notifications (in-app notification store)
// ---------------------------------------------------------------------------
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(), // ULID
    type: text("type", {
      enum: ["win", "error", "info", "digest"],
    }).notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    priority: text("priority", {
      enum: ["low", "normal", "high", "urgent"],
    })
      .default("normal")
      .notNull(),
    data: text("data").default("{}"), // JSON
    isRead: integer("is_read").default(0).notNull(),
    readAt: text("read_at"),
    createdAt: text("created_at").default(currentTimestamp).notNull(),
  },
  (table) => [
    index("idx_notifications_type").on(table.type),
    index("idx_notifications_priority").on(table.priority),
    index("idx_notifications_is_read").on(table.isRead),
    index("idx_notifications_created_at").on(table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// audit_log
// ---------------------------------------------------------------------------
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(), // ULID
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: text("details").default("{}"), // JSON
    createdAt: text("created_at").default(currentTimestamp).notNull(),
  },
  (table) => [index("idx_audit_log_action").on(table.action)],
);
