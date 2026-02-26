import { z } from "zod";

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

export interface BrowserFingerprint {
  id: string;
  userAgent: string;
  viewportWidth: number;
  viewportHeight: number;
  screenWidth: number;
  screenHeight: number;
  colorDepth: number;
  timezone: string;
  language: string;
  platform: string;
  webglVendor: string | null;
  webglRenderer: string | null;
  canvasHash: string | null;
  audioHash: string | null;
  fonts: string[];
  plugins: string[];
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  touchSupport: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Browser session
// ---------------------------------------------------------------------------

export interface BrowserSession {
  /** Unique session identifier */
  sessionId: string;

  /** Profile this session is running for */
  profileId: string;

  /** Contest being entered in this session */
  contestId: string;

  /** Fingerprint applied to the session */
  fingerprintId: string;

  /** Proxy being used (null = direct connection) */
  proxyId: string | null;

  /** Whether the browser is running in headless mode */
  headless: boolean;

  /** Current page URL */
  currentUrl: string | null;

  /** Session start time */
  startedAt: string;

  /** Session status */
  status: "initializing" | "active" | "idle" | "error" | "closed";
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BrowserConfig {
  /** Run the browser in headless mode */
  headless: boolean;

  /** Default navigation timeout in milliseconds */
  defaultTimeoutMs: number;

  /** Maximum number of concurrent browser instances */
  maxConcurrentBrowsers: number;

  /** Path to browser executable (empty = bundled) */
  executablePath: string;

  /** Extra arguments passed to the browser process */
  extraArgs: string[];

  /** Whether to enable request interception for ad/tracker blocking */
  blockAds: boolean;

  /** Whether to use stealth plugins */
  useStealth: boolean;

  /** Screenshot format */
  screenshotFormat: "png" | "jpeg";

  /** Screenshot quality (1-100, only for jpeg) */
  screenshotQuality: number;

  /** Directory to store screenshots */
  screenshotDir: string;

  /** Whether to record video of sessions */
  recordVideo: boolean;

  /** Directory to store video recordings */
  videoDir: string;

  /** User data directory for persistent sessions */
  userDataDir: string;
}

export interface StealthConfig {
  /** Apply WebGL vendor/renderer spoofing */
  spoofWebgl: boolean;

  /** Apply canvas fingerprint noise */
  spoofCanvas: boolean;

  /** Apply audio context fingerprint noise */
  spoofAudio: boolean;

  /** Mask the navigator.hardwareConcurrency value */
  maskHardwareConcurrency: boolean;

  /** Mask the navigator.deviceMemory value */
  maskDeviceMemory: boolean;

  /** Override navigator.platform */
  overridePlatform: boolean;

  /** Override navigator.language and navigator.languages */
  overrideLanguage: boolean;

  /** Override the timezone */
  overrideTimezone: boolean;

  /** Mask WebRTC local IP leak */
  maskWebRTC: boolean;

  /** Evasion techniques for headless detection */
  evasions: StealthEvasion[];
}

export type StealthEvasion =
  | "chrome-app"
  | "chrome-csi"
  | "chrome-load-times"
  | "chrome-runtime"
  | "iframe-content-window"
  | "media-codecs"
  | "navigator-hardware-concurrency"
  | "navigator-languages"
  | "navigator-permissions"
  | "navigator-plugins"
  | "navigator-vendor"
  | "navigator-webdriver"
  | "sourceurl"
  | "user-agent-override"
  | "webgl-vendor"
  | "window-outerdimensions";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const browserConfigSchema = z.object({
  headless: z.boolean(),
  defaultTimeoutMs: z.number().int().min(5_000).max(120_000),
  maxConcurrentBrowsers: z.number().int().min(1).max(20),
  executablePath: z.string(),
  extraArgs: z.array(z.string()),
  blockAds: z.boolean(),
  useStealth: z.boolean(),
  screenshotFormat: z.enum(["png", "jpeg"]),
  screenshotQuality: z.number().int().min(1).max(100),
  screenshotDir: z.string(),
  recordVideo: z.boolean(),
  videoDir: z.string(),
  userDataDir: z.string(),
});

export const stealthConfigSchema = z.object({
  spoofWebgl: z.boolean(),
  spoofCanvas: z.boolean(),
  spoofAudio: z.boolean(),
  maskHardwareConcurrency: z.boolean(),
  maskDeviceMemory: z.boolean(),
  overridePlatform: z.boolean(),
  overrideLanguage: z.boolean(),
  overrideTimezone: z.boolean(),
  maskWebRTC: z.boolean(),
  evasions: z.array(
    z.enum([
      "chrome-app",
      "chrome-csi",
      "chrome-load-times",
      "chrome-runtime",
      "iframe-content-window",
      "media-codecs",
      "navigator-hardware-concurrency",
      "navigator-languages",
      "navigator-permissions",
      "navigator-plugins",
      "navigator-vendor",
      "navigator-webdriver",
      "sourceurl",
      "user-agent-override",
      "webgl-vendor",
      "window-outerdimensions",
    ]),
  ),
});
