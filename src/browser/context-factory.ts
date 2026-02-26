/**
 * Factory for creating isolated, stealth-configured Playwright browser contexts.
 * Each context gets a unique fingerprint, optional proxy, and anti-detection
 * init scripts so that every "session" looks like a distinct real user.
 */

import type { Browser, BrowserContext } from 'playwright';
import { getLogger } from '../shared/logger.js';
import type { BrowserFingerprint } from './fingerprint-generator.js';
import { getStealthScripts } from './stealth-config.js';

const logger = getLogger('browser', { component: 'context-factory' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

export interface ContextOptions {
  fingerprint?: BrowserFingerprint;
  proxy?: ProxyConfig;
  geolocation?: { latitude: number; longitude: number; accuracy?: number };
  locale?: string;
  timezone?: string;
  extraHeaders?: Record<string, string>;
  recordVideo?: boolean;
  ignoreHTTPSErrors?: boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an isolated BrowserContext with stealth configuration, fingerprint
 * overrides, optional proxy, and anti-fingerprinting init scripts.
 */
export async function createContext(
  browser: Browser,
  options: ContextOptions = {},
): Promise<BrowserContext> {
  const {
    fingerprint,
    proxy,
    geolocation,
    locale,
    timezone,
    extraHeaders,
    recordVideo = false,
    ignoreHTTPSErrors = true,
  } = options;

  const contextOptions: Record<string, unknown> = {
    ignoreHTTPSErrors,
    javaScriptEnabled: true,
    acceptDownloads: false,
    bypassCSP: false,
  };

  // Apply fingerprint-derived settings
  if (fingerprint) {
    contextOptions.userAgent = fingerprint.userAgent;
    contextOptions.viewport = {
      width: fingerprint.viewport.width,
      height: fingerprint.viewport.height,
    };
    contextOptions.screen = {
      width: fingerprint.screen.width,
      height: fingerprint.screen.height,
    };
    contextOptions.locale = fingerprint.language;
    contextOptions.timezoneId = fingerprint.timezone;
    contextOptions.colorScheme = 'light';
    contextOptions.deviceScaleFactor = 1;
    contextOptions.hasTouch = fingerprint.maxTouchPoints > 0;
  }

  // Override locale/timezone if explicitly provided
  if (locale) {
    contextOptions.locale = locale;
  }
  if (timezone) {
    contextOptions.timezoneId = timezone;
  }

  // Geolocation
  if (geolocation) {
    contextOptions.geolocation = {
      latitude: geolocation.latitude,
      longitude: geolocation.longitude,
      accuracy: geolocation.accuracy ?? 50,
    };
    contextOptions.permissions = ['geolocation'];
  }

  // Proxy
  if (proxy) {
    contextOptions.proxy = {
      server: proxy.server,
      ...(proxy.username ? { username: proxy.username } : {}),
      ...(proxy.password ? { password: proxy.password } : {}),
    };
  }

  // Video recording for debugging
  if (recordVideo) {
    contextOptions.recordVideo = {
      dir: './data/videos/',
      size: fingerprint
        ? { width: fingerprint.viewport.width, height: fingerprint.viewport.height }
        : { width: 1280, height: 720 },
    };
  }

  const context = await browser.newContext(contextOptions);

  // Extra HTTP headers
  if (extraHeaders) {
    await context.setExtraHTTPHeaders(extraHeaders);
  }

  // Inject all stealth scripts
  const stealthScripts = getStealthScripts();
  for (const script of stealthScripts) {
    await context.addInitScript(script);
  }

  // Inject fingerprint-specific globals that stealth scripts reference
  if (fingerprint) {
    await context.addInitScript(`
      window.__WEBGL_VENDOR__ = ${JSON.stringify(fingerprint.webgl.vendor)};
      window.__WEBGL_RENDERER__ = ${JSON.stringify(fingerprint.webgl.renderer)};
      window.__HARDWARE_CONCURRENCY__ = ${fingerprint.hardwareConcurrency};
      window.__DEVICE_MEMORY__ = ${fingerprint.deviceMemory};
    `);

    // Override navigator.platform and navigator.languages
    await context.addInitScript(`
      Object.defineProperty(navigator, 'platform', {
        get: () => ${JSON.stringify(fingerprint.platform)},
        configurable: true,
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ${JSON.stringify(fingerprint.languages)},
        configurable: true,
      });
      Object.defineProperty(navigator, 'language', {
        get: () => ${JSON.stringify(fingerprint.language)},
        configurable: true,
      });
      Object.defineProperty(screen, 'colorDepth', {
        get: () => ${fingerprint.colorDepth},
        configurable: true,
      });
      Object.defineProperty(screen, 'pixelDepth', {
        get: () => ${fingerprint.colorDepth},
        configurable: true,
      });
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => ${fingerprint.maxTouchPoints},
        configurable: true,
      });
    `);
  }

  logger.debug(
    {
      fingerprintId: fingerprint?.id,
      hasProxy: !!proxy,
      hasGeo: !!geolocation,
      locale: contextOptions.locale,
      timezone: contextOptions.timezoneId,
    },
    'Created browser context',
  );

  return context;
}
