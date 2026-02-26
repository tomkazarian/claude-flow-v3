/**
 * Browser automation module public API.
 * Re-exports all types, classes, and functions needed by consumers.
 */

// Browser pool
export { BrowserPool } from './browser-pool.js';
export type { BrowserPoolOptions, SupportedBrowserType } from './browser-pool.js';

// Context factory
export { createContext } from './context-factory.js';
export type { ContextOptions, ProxyConfig } from './context-factory.js';

// Stealth configuration
export { getStealthArgs, getStealthScripts } from './stealth-config.js';
export type { StealthArgsOptions } from './stealth-config.js';

// Fingerprint generation
export {
  generateFingerprint,
  getFingerprint,
  saveFingerprint,
  deleteFingerprint,
  getFingerprintCount,
} from './fingerprint-generator.js';
export type { BrowserFingerprint } from './fingerprint-generator.js';

// Human-like interaction
export { Humanizer, humanWait } from './humanizer.js';

// Page utilities
export {
  waitForNavigation,
  waitForSelector,
  getPageText,
  getFormFields,
  isVisible,
  scrollToElement,
  clickAndWaitForNavigation,
  extractLinks,
  hasText,
  takeScreenshot,
} from './page-utils.js';
export type { NavigationOptions, FormField } from './page-utils.js';

// Screenshot capture
export {
  captureOnFailure,
  captureEntryProof,
  cleanupOldScreenshots,
} from './screenshot-capture.js';

// Cookie management
export {
  saveCookies,
  loadCookies,
  clearCookies,
  getCookiesForDomain,
  deleteStoredCookies,
  listCookieSessions,
  getCookieStoreSize,
} from './cookie-manager.js';
export type { StoredCookie } from './cookie-manager.js';
