/**
 * Seed script -- populates the database with sample profiles, discovery
 * sources, browser fingerprints, and default app settings.
 *
 * Usage:
 *   npx tsx src/db/seed.ts
 *   npm run db:seed
 */
import { ulid } from "ulid";
import { count } from "drizzle-orm";
import { migrate } from "./migrate.js";
import { getDb, closeDb } from "./index.js";
import {
  profiles,
  discoverySources,
  browserFingerprints,
  appSettings,
  proxies,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Run migration first (idempotent)
// ---------------------------------------------------------------------------
migrate();
const db = getDb();

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
const sampleProfiles = [
  {
    id: ulid(),
    firstName: "Alice",
    lastName: "Johnson",
    email: "alice.johnson@example.com",
    emailAliases: JSON.stringify(["a.johnson@example.com"]),
    phone: "+15551234567",
    phoneProvider: "twilio",
    addressLine1: "123 Main St",
    addressLine2: "Apt 4B",
    city: "Springfield",
    state: "IL",
    zip: "62701",
    country: "US",
    dateOfBirth: "1990-05-15",
    gender: "female",
    socialAccounts: JSON.stringify({
      twitter: "alice_j",
      instagram: "alicejohnson",
    }),
    isActive: 1,
  },
  {
    id: ulid(),
    firstName: "Bob",
    lastName: "Smith",
    email: "bob.smith@example.com",
    emailAliases: JSON.stringify([]),
    phone: "+15559876543",
    phoneProvider: "twilio",
    addressLine1: "456 Oak Ave",
    addressLine2: null,
    city: "Portland",
    state: "OR",
    zip: "97201",
    country: "US",
    dateOfBirth: "1985-11-22",
    gender: "male",
    socialAccounts: JSON.stringify({
      twitter: "bobsmith",
      facebook: "bob.smith.99",
    }),
    isActive: 1,
  },
  {
    id: ulid(),
    firstName: "Carol",
    lastName: "Martinez",
    email: "carol.m@example.com",
    emailAliases: JSON.stringify([
      "carol.martinez@example.com",
      "c.martinez@example.com",
    ]),
    phone: "+15555550199",
    phoneProvider: "vonage",
    addressLine1: "789 Pine Rd",
    addressLine2: "Suite 100",
    city: "Austin",
    state: "TX",
    zip: "73301",
    country: "US",
    dateOfBirth: "1993-03-08",
    gender: "female",
    socialAccounts: JSON.stringify({
      instagram: "carol_m",
    }),
    isActive: 1,
  },
];

// ---------------------------------------------------------------------------
// Discovery Sources
//
// These sources are wired into the real discovery module. The `name` field
// is used to map to specialized handlers (SweepstakesAdvantageSource,
// OnlineSweepstakesSource). The `config` JSON is passed to the handler
// and should contain `maxPages`, `categories`, and optionally `selectors`
// matching the DiscoverySource interface in src/discovery/types.ts.
// ---------------------------------------------------------------------------
const sampleSources = [
  {
    id: ulid(),
    name: "SweepstakesAdvantage",
    type: "crawler" as const,
    url: "https://www.sweepstakesadvantage.com",
    config: JSON.stringify({
      maxPages: 5,
      categories: ["all"],
      rateLimitMs: 2500,
    }),
    isActive: 1,
    contestsFound: 0,
    errorCount: 0,
    schedule: "0 */4 * * *",
  },
  {
    id: ulid(),
    name: "Online-Sweepstakes",
    type: "crawler" as const,
    url: "https://www.online-sweepstakes.com",
    config: JSON.stringify({
      maxPages: 5,
      categories: ["new", "expiring"],
      rateLimitMs: 2500,
    }),
    isActive: 1,
    contestsFound: 0,
    errorCount: 0,
    schedule: "0 */4 * * *",
  },
  {
    id: ulid(),
    name: "ContestGirl RSS",
    type: "rss" as const,
    url: "https://www.contestgirl.com/rss.php",
    config: JSON.stringify({ format: "rss2" }),
    isActive: 1,
    contestsFound: 0,
    errorCount: 0,
    schedule: "0 */6 * * *",
  },
  {
    id: ulid(),
    name: "Sweeties Sweeps RSS",
    type: "rss" as const,
    url: "https://sweetiessweeps.com/feed",
    config: JSON.stringify({ format: "rss2" }),
    isActive: 1,
    contestsFound: 0,
    errorCount: 0,
    schedule: "0 */6 * * *",
  },
  {
    // NOTE: Gleam does not offer a public API. This source requires a
    // valid API key configured in the environment (GLEAM_API_KEY).
    // Disabled by default until credentials are provided.
    id: ulid(),
    name: "Gleam API",
    type: "api" as const,
    url: "https://gleam.io/api/competitions",
    config: JSON.stringify({
      apiVersion: "v1",
      categories: ["sweepstakes", "giveaway"],
      limit: 50,
    }),
    isActive: 0,
    contestsFound: 0,
    errorCount: 0,
    schedule: "0 */2 * * *",
  },
  {
    // NOTE: Twitter/X API requires a Bearer token (TWITTER_BEARER_TOKEN).
    // Disabled by default until credentials are provided.
    id: ulid(),
    name: "Twitter Giveaway Scanner",
    type: "social" as const,
    url: "https://api.twitter.com/2/tweets/search/recent",
    config: JSON.stringify({
      queries: [
        "#giveaway #sweepstakes",
        "#contest #win",
        "RT to win",
      ],
      maxResults: 100,
    }),
    isActive: 0,
    contestsFound: 0,
    errorCount: 0,
    schedule: "*/30 * * * *",
  },
];

// ---------------------------------------------------------------------------
// Browser Fingerprints
// ---------------------------------------------------------------------------
const sampleFingerprints = [
  {
    id: ulid(),
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewportWidth: 1920,
    viewportHeight: 1080,
    screenWidth: 1920,
    screenHeight: 1080,
    colorDepth: 24,
    timezone: "America/New_York",
    language: "en-US",
    platform: "Win32",
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer:
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)",
    canvasHash: "a1b2c3d4e5f6",
    audioHash: "f6e5d4c3b2a1",
    fonts: JSON.stringify([
      "Arial",
      "Verdana",
      "Times New Roman",
      "Courier New",
      "Georgia",
    ]),
    plugins: JSON.stringify(["PDF Viewer", "Chrome PDF Viewer"]),
    hardwareConcurrency: 12,
    deviceMemory: 8,
    touchSupport: 0,
    usageCount: 0,
  },
  {
    id: ulid(),
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewportWidth: 1440,
    viewportHeight: 900,
    screenWidth: 2560,
    screenHeight: 1600,
    colorDepth: 30,
    timezone: "America/Los_Angeles",
    language: "en-US",
    platform: "MacIntel",
    webglVendor: "Apple",
    webglRenderer: "Apple M1 Pro",
    canvasHash: "x9y8z7w6v5u4",
    audioHash: "u4v5w6x7y8z9",
    fonts: JSON.stringify([
      "Arial",
      "Helvetica",
      "Times New Roman",
      "Menlo",
      "SF Pro",
    ]),
    plugins: JSON.stringify(["PDF Viewer"]),
    hardwareConcurrency: 10,
    deviceMemory: 8,
    touchSupport: 0,
    usageCount: 0,
  },
];

// ---------------------------------------------------------------------------
// Sample Proxies
// ---------------------------------------------------------------------------
const sampleProxies = [
  {
    id: ulid(),
    provider: "brightdata",
    host: "proxy.example.com",
    port: 22225,
    username: "user1",
    password: "pass1",
    protocol: "http" as const,
    country: "US",
    state: "CA",
    city: "Los Angeles",
    type: "residential" as const,
    isActive: 1,
    healthStatus: "healthy" as const,
    successCount: 0,
    failureCount: 0,
  },
  {
    id: ulid(),
    provider: "oxylabs",
    host: "dc.proxy.example.com",
    port: 60000,
    username: "user2",
    password: "pass2",
    protocol: "http" as const,
    country: "US",
    state: "NY",
    city: "New York",
    type: "datacenter" as const,
    isActive: 1,
    healthStatus: "unknown" as const,
    successCount: 0,
    failureCount: 0,
  },
];

// ---------------------------------------------------------------------------
// App Settings
// ---------------------------------------------------------------------------
const sampleSettings = [
  {
    key: "app.version",
    value: JSON.stringify("0.1.0"),
  },
  {
    key: "scheduler.enabled",
    value: JSON.stringify(true),
  },
  {
    key: "scheduler.maxConcurrentEntries",
    value: JSON.stringify(3),
  },
  {
    key: "scheduler.entryDelayMs",
    value: JSON.stringify({ min: 5000, max: 30000 }),
  },
  {
    key: "captcha.defaultProvider",
    value: JSON.stringify("2captcha"),
  },
  {
    key: "captcha.maxCostPerSolve",
    value: JSON.stringify(0.01),
  },
  {
    key: "proxy.rotationStrategy",
    value: JSON.stringify("round-robin"),
  },
  {
    key: "proxy.healthCheckIntervalMs",
    value: JSON.stringify(300_000),
  },
  {
    key: "browser.headless",
    value: JSON.stringify(true),
  },
  {
    key: "browser.defaultTimeout",
    value: JSON.stringify(30_000),
  },
  {
    key: "notifications.channels",
    value: JSON.stringify(["email", "discord"]),
  },
  {
    key: "notifications.winAlertEnabled",
    value: JSON.stringify(true),
  },
  {
    key: "discovery.autoQueue",
    value: JSON.stringify(true),
  },
  {
    key: "discovery.minLegitimacyScore",
    value: JSON.stringify(0.6),
  },
];

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

function seed(): void {
  console.log("[seed] Inserting sample data...");

  // Guard: skip if already seeded (check profiles as sentinel)
  const [existing] = db.select({ value: count() }).from(profiles).all();
  if (existing && existing.value > 0) {
    console.log(
      `[seed] Database already contains ${existing.value} profile(s). Skipping seed to avoid duplicates.`,
    );
    return;
  }

  for (const p of sampleProfiles) {
    db.insert(profiles).values(p).run();
  }
  console.log(`[seed]   ${sampleProfiles.length} profiles`);

  for (const s of sampleSources) {
    db.insert(discoverySources).values(s).run();
  }
  console.log(`[seed]   ${sampleSources.length} discovery sources`);

  for (const f of sampleFingerprints) {
    db.insert(browserFingerprints).values(f).run();
  }
  console.log(`[seed]   ${sampleFingerprints.length} browser fingerprints`);

  for (const p of sampleProxies) {
    db.insert(proxies).values(p).run();
  }
  console.log(`[seed]   ${sampleProxies.length} proxies`);

  for (const s of sampleSettings) {
    db.insert(appSettings).values(s).run();
  }
  console.log(`[seed]   ${sampleSettings.length} app settings`);

  console.log("[seed] Done.");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isDirectRun =
  process.argv[1]?.endsWith("seed.ts") ||
  process.argv[1]?.endsWith("seed.js");

if (isDirectRun) {
  try {
    seed();
    closeDb();
    process.exit(0);
  } catch (err) {
    console.error("[seed] Failed:", err);
    process.exit(1);
  }
}

export { seed };
