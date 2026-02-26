/**
 * Generates random but internally-consistent browser fingerprints.
 * Each fingerprint pairs a user-agent string with matching platform info,
 * GPU combos, screen dimensions, locale, timezone, and other hardware traits
 * so that a fingerprinting script sees a coherent "real" browser profile.
 */

import { generateId } from '../shared/crypto.js';
import { getLogger } from '../shared/logger.js';

const logger = getLogger('browser', { component: 'fingerprint-generator' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserFingerprint {
  id: string;
  userAgent: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number; availWidth: number; availHeight: number };
  colorDepth: number;
  timezone: string;
  language: string;
  languages: string[];
  platform: string;
  webgl: { vendor: string; renderer: string };
  canvasHash: string;
  audioHash: string;
  fonts: string[];
  plugins: string[];
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  createdAt: string;
}

type OsFamily = 'windows' | 'macos';

interface OsProfile {
  family: OsFamily;
  platform: string;
  oscpu: string;
  timezones: string[];
  locales: string[];
}

interface GpuCombo {
  vendor: string;
  renderer: string;
  osFamily: OsFamily;
}

// ---------------------------------------------------------------------------
// Data pools
// ---------------------------------------------------------------------------

const OS_PROFILES: OsProfile[] = [
  {
    family: 'windows',
    platform: 'Win32',
    oscpu: 'Windows NT 10.0; Win64; x64',
    timezones: [
      'America/New_York', 'America/Chicago', 'America/Denver',
      'America/Los_Angeles', 'America/Phoenix', 'America/Detroit',
      'America/Indianapolis', 'America/Kentucky/Louisville',
      'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    ],
    locales: ['en-US', 'en-GB', 'fr-FR', 'de-DE', 'es-ES'],
  },
  {
    family: 'macos',
    platform: 'MacIntel',
    oscpu: 'Intel Mac OS X 10_15_7',
    timezones: [
      'America/New_York', 'America/Chicago', 'America/Denver',
      'America/Los_Angeles', 'America/Phoenix',
      'Europe/London', 'Europe/Paris', 'Europe/Berlin',
      'Asia/Tokyo', 'Australia/Sydney',
    ],
    locales: ['en-US', 'en-GB', 'en-AU', 'ja-JP', 'fr-FR'],
  },
];

const GPU_COMBOS: GpuCombo[] = [
  // NVIDIA - Windows
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  // AMD - Windows
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 5700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 7900 XTX Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  // Intel - Windows
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', osFamily: 'windows' },
  // Apple - macOS
  { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)', osFamily: 'macos' },
  { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)', osFamily: 'macos' },
  { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1 Max, OpenGL 4.1)', osFamily: 'macos' },
  { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)', osFamily: 'macos' },
  { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)', osFamily: 'macos' },
  { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2 Max, OpenGL 4.1)', osFamily: 'macos' },
  // Intel - macOS
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris Plus Graphics 640, OpenGL 4.1)', osFamily: 'macos' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.1)', osFamily: 'macos' },
];

/** Realistic viewport/screen combos. */
const SCREEN_PROFILES = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 2560, height: 1440 },
  { width: 1536, height: 864 },
  { width: 1680, height: 1050 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1200 },
  { width: 2560, height: 1600 },
  { width: 3840, height: 2160 },
] as const;

const COMMON_FONTS = [
  'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
  'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype',
  'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Segoe UI',
  'Roboto', 'Helvetica', 'Helvetica Neue', 'Microsoft Sans Serif',
  'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia', 'Corbel',
];

const MAC_FONTS = [
  'Menlo', 'SF Pro', 'SF Mono', 'Avenir', 'Avenir Next', 'Futura',
  'Gill Sans', 'Optima', 'American Typewriter', 'Baskerville', 'Didot',
  'Hoefler Text', 'Marker Felt', 'Noteworthy', 'Papyrus',
];

const WINDOWS_FONTS = [
  'Segoe UI', 'Segoe UI Symbol', 'Segoe UI Emoji', 'Franklin Gothic Medium',
  'Lucida Bright', 'Marlett', 'MS Gothic', 'MS PGothic', 'MS Mincho',
  'Malgun Gothic', 'Microsoft YaHei', 'Microsoft JhengHei',
];

const PLUGIN_NAMES = [
  'Chrome PDF Plugin', 'Chrome PDF Viewer', 'Native Client',
];

// ---------------------------------------------------------------------------
// User-agent pool
// ---------------------------------------------------------------------------

function buildUserAgents(): Array<{ ua: string; browser: string; version: number; osFamily: OsFamily }> {
  const agents: Array<{ ua: string; browser: string; version: number; osFamily: OsFamily }> = [];

  // Chrome 120-130 on Windows 10/11
  for (let v = 120; v <= 130; v++) {
    const buildNo = 6099 + (v - 120) * 50 + Math.floor(Math.random() * 50);
    agents.push({
      ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.${buildNo}.0 Safari/537.36`,
      browser: 'chrome', version: v, osFamily: 'windows',
    });
  }

  // Chrome 120-130 on macOS 13/14
  for (let v = 120; v <= 130; v++) {
    const buildNo = 6099 + (v - 120) * 50 + Math.floor(Math.random() * 50);
    for (const macVer of ['13_0', '13_5_2', '14_0', '14_2_1', '14_4']) {
      agents.push({
        ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macVer}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.${buildNo}.0 Safari/537.36`,
        browser: 'chrome', version: v, osFamily: 'macos',
      });
    }
  }

  // NOTE: Firefox and Edge UAs have been removed. The stealth scripts
  // exclusively spoof Chrome-specific APIs (window.chrome, Chrome plugins,
  // chrome.runtime, chrome.loadTimes, etc.). Emitting a Firefox or Edge
  // user-agent while those APIs exist is an impossible combination that
  // fingerprinting services detect immediately. Since the browser pool only
  // launches Chromium, only Chrome UAs are appropriate.

  return agents;
}

const USER_AGENTS = buildUserAgents();

// ---------------------------------------------------------------------------
// In-memory store for persistence
// ---------------------------------------------------------------------------

const fingerprintStore = new Map<string, BrowserFingerprint>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomHex(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function pickSubset<T>(arr: readonly T[], minCount: number, maxCount: number): T[] {
  const count = randomInt(minCount, Math.min(maxCount, arr.length));
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a fresh, internally-consistent browser fingerprint.
 * The user-agent, platform, GPU, timezone, and language all match
 * the chosen operating system family.
 */
export function generateFingerprint(): BrowserFingerprint {
  // 1. Pick a user-agent entry (this determines the OS family)
  const uaEntry = pick(USER_AGENTS);
  const osFamily = uaEntry.osFamily;

  // 2. Find the matching OS profile
  const osProfile = OS_PROFILES.find(p => p.family === osFamily);
  if (!osProfile) {
    throw new Error(`No OS profile for family: ${osFamily}`);
  }

  // 3. Pick a GPU combo matching the OS
  const matchingGpus = GPU_COMBOS.filter(g => g.osFamily === osFamily);
  const gpu = pick(matchingGpus);

  // 4. Pick screen/viewport
  const screen = pick(SCREEN_PROFILES);
  const taskbarHeight = randomInt(30, 50);

  // 5. Pick locale/timezone pair
  const locale = pick(osProfile.locales);
  const timezone = pick(osProfile.timezones);

  // 6. Pick fonts (common + OS-specific)
  const osFonts = osFamily === 'macos' ? MAC_FONTS : WINDOWS_FONTS;
  const fonts = [
    ...pickSubset(COMMON_FONTS, 10, 18),
    ...pickSubset(osFonts, 3, 8),
  ];

  // 7. Hardware
  const hardwareConcurrency = pick([2, 4, 4, 6, 8, 8, 8, 10, 12, 16]);
  const deviceMemory = pick([2, 4, 4, 8, 8, 8, 16]);

  const fp: BrowserFingerprint = {
    id: generateId(),
    userAgent: uaEntry.ua,
    viewport: { width: screen.width, height: screen.height - taskbarHeight },
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.width,
      availHeight: screen.height - taskbarHeight,
    },
    colorDepth: pick([24, 24, 24, 30, 32]),
    timezone,
    language: locale,
    languages: buildLanguages(locale),
    platform: osProfile.platform,
    webgl: { vendor: gpu.vendor, renderer: gpu.renderer },
    canvasHash: randomHex(32),
    audioHash: randomHex(16),
    fonts,
    plugins: [...PLUGIN_NAMES],
    hardwareConcurrency,
    deviceMemory,
    maxTouchPoints: 0, // Desktop browsers
    createdAt: new Date().toISOString(),
  };

  logger.debug({ fingerprintId: fp.id, osFamily, browser: uaEntry.browser }, 'Generated fingerprint');
  return fp;
}

/**
 * Retrieves a previously saved fingerprint by ID.
 * Returns undefined if not found.
 */
export function getFingerprint(id: string): BrowserFingerprint | undefined {
  return fingerprintStore.get(id);
}

/**
 * Persists a fingerprint to the in-memory store.
 * For production use this should be backed by the database;
 * the in-memory store keeps the module dependency-free.
 */
export function saveFingerprint(fp: BrowserFingerprint): void {
  fingerprintStore.set(fp.id, fp);
  logger.debug({ fingerprintId: fp.id }, 'Saved fingerprint');
}

/**
 * Returns the number of stored fingerprints.
 */
export function getFingerprintCount(): number {
  return fingerprintStore.size;
}

/**
 * Removes a fingerprint from the store.
 */
export function deleteFingerprint(id: string): boolean {
  return fingerprintStore.delete(id);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildLanguages(primaryLocale: string): string[] {
  const lang = primaryLocale.split('-')[0] ?? 'en';
  const result = [primaryLocale];
  if (primaryLocale !== lang) {
    result.push(lang);
  }
  // Many browsers include 'en' as fallback
  if (lang !== 'en') {
    result.push('en-US', 'en');
  }
  return result;
}
