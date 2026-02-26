/**
 * Migration runner for the sweepstakes platform.
 *
 * Creates all tables, indexes, and unique constraints if they do not
 * already exist. Uses raw SQL via better-sqlite3 so the migration is
 * idempotent and can run without drizzle-kit tooling at runtime.
 *
 * Usage:
 *   npx tsx src/db/migrate.ts            # standalone
 *   import { migrate } from './migrate'  # programmatic
 */
import { getSqlite, closeDb } from "./index.js";

// ---------------------------------------------------------------------------
// DDL statements
// ---------------------------------------------------------------------------

const DDL_STATEMENTS: string[] = [
  // ── profiles ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS profiles (
    id               TEXT PRIMARY KEY,
    first_name       TEXT NOT NULL,
    last_name        TEXT NOT NULL,
    email            TEXT NOT NULL,
    email_aliases    TEXT DEFAULT '[]',
    phone            TEXT,
    phone_provider   TEXT,
    address_line1    TEXT,
    address_line2    TEXT,
    city             TEXT,
    state            TEXT,
    zip              TEXT,
    country          TEXT NOT NULL DEFAULT 'US',
    date_of_birth    TEXT,
    gender           TEXT,
    social_accounts  TEXT DEFAULT '{}',
    is_active        INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  // ── contests ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS contests (
    id                      TEXT PRIMARY KEY,
    external_id             TEXT NOT NULL,
    url                     TEXT NOT NULL,
    title                   TEXT NOT NULL,
    sponsor                 TEXT,
    description             TEXT,
    source                  TEXT,
    source_url              TEXT,
    type                    TEXT NOT NULL CHECK(type IN ('sweepstakes','raffle','giveaway','instant_win','contest','daily')),
    entry_method            TEXT NOT NULL CHECK(entry_method IN ('form','social','email','purchase','multi')),
    status                  TEXT NOT NULL DEFAULT 'discovered' CHECK(status IN ('discovered','queued','active','completed','expired','invalid','blocked')),
    start_date              TEXT,
    end_date                TEXT,
    entry_frequency         TEXT DEFAULT 'once' CHECK(entry_frequency IN ('once','daily','weekly','unlimited')),
    max_entries             INTEGER,
    prize_description       TEXT,
    prize_value             REAL,
    prize_category          TEXT,
    age_requirement         INTEGER DEFAULT 18,
    geo_restrictions        TEXT DEFAULT '{}',
    requires_captcha        INTEGER DEFAULT 0,
    requires_email_confirm  INTEGER DEFAULT 0,
    requires_sms_verify     INTEGER DEFAULT 0,
    requires_social_action  INTEGER DEFAULT 0,
    social_actions          TEXT DEFAULT '[]',
    terms_url               TEXT,
    difficulty_score        REAL,
    legitimacy_score        REAL,
    priority_score          REAL,
    form_mapping            TEXT DEFAULT '{}',
    screenshot_path         TEXT,
    last_checked_at         TEXT,
    metadata                TEXT DEFAULT '{}',
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  // ── entries ───────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS entries (
    id                TEXT PRIMARY KEY,
    contest_id        TEXT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitted','confirmed','failed','won','lost','expired','duplicate')),
    attempt_number    INTEGER NOT NULL DEFAULT 1,
    entry_method      TEXT,
    proxy_used        TEXT,
    fingerprint_id    TEXT,
    captcha_solved    INTEGER DEFAULT 0,
    captcha_type      TEXT,
    captcha_cost      REAL,
    email_confirmed   INTEGER DEFAULT 0,
    sms_verified      INTEGER DEFAULT 0,
    social_completed  INTEGER DEFAULT 0,
    screenshot_path   TEXT,
    error_message     TEXT,
    error_screenshot  TEXT,
    duration_ms       INTEGER,
    submitted_at      TEXT,
    confirmed_at      TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  // ── entry_limits ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS entry_limits (
    id               TEXT PRIMARY KEY,
    contest_id       TEXT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    profile_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    last_entry_at    TEXT,
    entry_count      INTEGER NOT NULL DEFAULT 0,
    next_eligible_at TEXT,
    UNIQUE(contest_id, profile_id)
  )`,

  // ── wins ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS wins (
    id                  TEXT PRIMARY KEY,
    entry_id            TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    contest_id          TEXT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    profile_id          TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    prize_description   TEXT,
    prize_value         REAL,
    detection_source    TEXT,
    detection_email_id  TEXT,
    claim_deadline      TEXT,
    claim_status        TEXT NOT NULL DEFAULT 'detected' CHECK(claim_status IN ('detected','notified','claiming','claimed','expired','forfeited')),
    claim_url           TEXT,
    notes               TEXT,
    tax_reported        INTEGER DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  // ── proxies ───────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS proxies (
    id                TEXT PRIMARY KEY,
    provider          TEXT,
    host              TEXT NOT NULL,
    port              INTEGER NOT NULL,
    username          TEXT,
    password          TEXT,
    protocol          TEXT NOT NULL DEFAULT 'http' CHECK(protocol IN ('http','https','socks5')),
    country           TEXT,
    state             TEXT,
    city              TEXT,
    type              TEXT CHECK(type IN ('residential','datacenter','mobile')),
    is_active         INTEGER NOT NULL DEFAULT 1,
    last_health_check TEXT,
    health_status     TEXT NOT NULL DEFAULT 'unknown' CHECK(health_status IN ('healthy','degraded','dead','unknown')),
    success_count     INTEGER NOT NULL DEFAULT 0,
    failure_count     INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms    REAL,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  // ── browser_fingerprints ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS browser_fingerprints (
    id                   TEXT PRIMARY KEY,
    user_agent           TEXT NOT NULL,
    viewport_width       INTEGER NOT NULL,
    viewport_height      INTEGER NOT NULL,
    screen_width         INTEGER NOT NULL,
    screen_height        INTEGER NOT NULL,
    color_depth          INTEGER NOT NULL DEFAULT 24,
    timezone             TEXT NOT NULL,
    language             TEXT NOT NULL DEFAULT 'en-US',
    platform             TEXT NOT NULL,
    webgl_vendor         TEXT,
    webgl_renderer       TEXT,
    canvas_hash          TEXT,
    audio_hash           TEXT,
    fonts                TEXT DEFAULT '[]',
    plugins              TEXT DEFAULT '[]',
    hardware_concurrency INTEGER,
    device_memory        INTEGER,
    touch_support        INTEGER DEFAULT 0,
    usage_count          INTEGER NOT NULL DEFAULT 0,
    last_used_at         TEXT,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  // ── email_accounts ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS email_accounts (
    id             TEXT PRIMARY KEY,
    profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    email_address  TEXT NOT NULL UNIQUE,
    provider       TEXT NOT NULL CHECK(provider IN ('gmail','outlook','imap')),
    oauth_tokens   TEXT,
    imap_config    TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1,
    last_sync_at   TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  // ── sms_numbers ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sms_numbers (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    phone_number    TEXT NOT NULL,
    provider        TEXT NOT NULL,
    provider_sid    TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    last_message_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  // ── social_accounts ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS social_accounts (
    id                    TEXT PRIMARY KEY,
    profile_id            TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    platform              TEXT NOT NULL,
    username              TEXT NOT NULL,
    oauth_tokens          TEXT,
    is_active             INTEGER NOT NULL DEFAULT 1,
    rate_limit_remaining  INTEGER,
    rate_limit_reset_at   TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(profile_id, platform)
  )`,

  // ── discovery_sources ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS discovery_sources (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL UNIQUE,
    type           TEXT NOT NULL CHECK(type IN ('crawler','rss','api','social')),
    url            TEXT,
    config         TEXT DEFAULT '{}',
    is_active      INTEGER NOT NULL DEFAULT 1,
    last_run_at    TEXT,
    contests_found INTEGER NOT NULL DEFAULT 0,
    error_count    INTEGER NOT NULL DEFAULT 0,
    schedule       TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  // ── cost_log ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS cost_log (
    id          TEXT PRIMARY KEY,
    category    TEXT NOT NULL CHECK(category IN ('captcha','proxy','sms','social')),
    provider    TEXT NOT NULL,
    amount      REAL NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'USD',
    entry_id    TEXT REFERENCES entries(id) ON DELETE SET NULL,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  // ── app_settings ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,

  // ── audit_log ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT PRIMARY KEY,
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   TEXT,
    details     TEXT DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
];

// ---------------------------------------------------------------------------
// Index DDL
// ---------------------------------------------------------------------------

const INDEX_STATEMENTS: string[] = [
  // contests
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_contests_external_id ON contests(external_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_contests_url ON contests(url)`,
  `CREATE INDEX IF NOT EXISTS idx_contests_status ON contests(status)`,
  `CREATE INDEX IF NOT EXISTS idx_contests_type ON contests(type)`,
  `CREATE INDEX IF NOT EXISTS idx_contests_end_date ON contests(end_date)`,
  `CREATE INDEX IF NOT EXISTS idx_contests_priority ON contests(priority_score)`,

  // entries
  `CREATE INDEX IF NOT EXISTS idx_entries_contest ON entries(contest_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_profile ON entries(profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status)`,
  `CREATE INDEX IF NOT EXISTS idx_entries_submitted ON entries(submitted_at)`,

  // entry_limits
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_entry_limits_contest_profile ON entry_limits(contest_id, profile_id)`,

  // wins
  `CREATE INDEX IF NOT EXISTS idx_wins_profile ON wins(profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wins_claim_status ON wins(claim_status)`,

  // proxies
  `CREATE INDEX IF NOT EXISTS idx_proxies_active ON proxies(is_active, health_status)`,
  `CREATE INDEX IF NOT EXISTS idx_proxies_geo ON proxies(country, state)`,

  // cost_log
  `CREATE INDEX IF NOT EXISTS idx_cost_log_category ON cost_log(category)`,

  // audit_log
  `CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all migrations (idempotent). Creates tables and indexes if they
 * do not already exist.
 */
export function migrate(dbPath?: string): void {
  const sqlite = getSqlite(dbPath);

  sqlite.exec("BEGIN TRANSACTION");
  try {
    for (const ddl of DDL_STATEMENTS) {
      sqlite.exec(ddl);
    }
    for (const idx of INDEX_STATEMENTS) {
      sqlite.exec(idx);
    }
    sqlite.exec("COMMIT");
    console.log(
      `[migrate] Successfully applied ${DDL_STATEMENTS.length} tables and ${INDEX_STATEMENTS.length} indexes.`,
    );
  } catch (err) {
    sqlite.exec("ROLLBACK");
    console.error("[migrate] Migration failed, rolled back.", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isDirectRun =
  process.argv[1]?.endsWith("migrate.ts") ||
  process.argv[1]?.endsWith("migrate.js");

if (isDirectRun) {
  try {
    migrate();
    closeDb();
    console.log("[migrate] Done.");
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
