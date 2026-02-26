/**
 * Cookie jar management for browser contexts.
 * Persists and restores cookies per session to maintain login state
 * across browser context re-creation. Uses an in-memory store that
 * can be swapped for a database-backed implementation.
 */

import type { BrowserContext, Cookie } from 'playwright';
import { getLogger } from '../shared/logger.js';

const logger = getLogger('browser', { component: 'cookie-manager' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

interface CookieJar {
  sessionId: string;
  cookies: StoredCookie[];
  savedAt: number;
}

// ---------------------------------------------------------------------------
// In-memory cookie store
// ---------------------------------------------------------------------------

const cookieStore = new Map<string, CookieJar>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Saves all cookies from a browser context into the store, keyed by sessionId.
 * Overwrites any previously stored cookies for the same session.
 */
export async function saveCookies(
  context: BrowserContext,
  sessionId: string,
): Promise<void> {
  const cookies = await context.cookies();

  const storedCookies: StoredCookie[] = cookies.map(normaliseCookie);

  cookieStore.set(sessionId, {
    sessionId,
    cookies: storedCookies,
    savedAt: Date.now(),
  });

  logger.debug(
    { sessionId, cookieCount: storedCookies.length },
    'Cookies saved',
  );
}

/**
 * Restores previously saved cookies into a browser context.
 * Does nothing if no cookies are stored for the given sessionId.
 */
export async function loadCookies(
  context: BrowserContext,
  sessionId: string,
): Promise<void> {
  const jar = cookieStore.get(sessionId);
  if (!jar || jar.cookies.length === 0) {
    logger.debug({ sessionId }, 'No cookies to load');
    return;
  }

  // Filter out expired cookies
  const now = Date.now() / 1000;
  const validCookies = jar.cookies.filter(c => c.expires === -1 || c.expires > now);

  if (validCookies.length === 0) {
    logger.debug({ sessionId }, 'All stored cookies have expired');
    return;
  }

  // Playwright expects the Cookie type for addCookies
  const playwrightCookies = validCookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
  }));

  await context.addCookies(playwrightCookies);

  logger.debug(
    { sessionId, loadedCount: playwrightCookies.length, expiredCount: jar.cookies.length - validCookies.length },
    'Cookies loaded',
  );
}

/**
 * Clears all cookies from a browser context.
 */
export async function clearCookies(context: BrowserContext): Promise<void> {
  await context.clearCookies();
  logger.debug('Cookies cleared from context');
}

/**
 * Retrieves stored cookies for a specific domain from the store.
 * Matches both exact domain and parent domain (e.g. `.example.com`).
 */
export function getCookiesForDomain(
  sessionId: string,
  domain: string,
): StoredCookie[] {
  const jar = cookieStore.get(sessionId);
  if (!jar) {
    return [];
  }

  const normalisedDomain = domain.toLowerCase();

  return jar.cookies.filter(c => {
    const cookieDomain = c.domain.toLowerCase();
    // Exact match
    if (cookieDomain === normalisedDomain) return true;
    // Leading dot means the cookie applies to subdomains too
    if (cookieDomain.startsWith('.') && normalisedDomain.endsWith(cookieDomain)) return true;
    // Check if the cookie domain matches as a parent
    if (normalisedDomain === cookieDomain.replace(/^\./, '')) return true;
    return false;
  });
}

/**
 * Removes all stored cookies for a session.
 */
export function deleteStoredCookies(sessionId: string): boolean {
  const deleted = cookieStore.delete(sessionId);
  if (deleted) {
    logger.debug({ sessionId }, 'Stored cookies deleted');
  }
  return deleted;
}

/**
 * Returns all session IDs that have stored cookies.
 */
export function listCookieSessions(): string[] {
  return Array.from(cookieStore.keys());
}

/**
 * Returns the total number of stored cookie jars.
 */
export function getCookieStoreSize(): number {
  return cookieStore.size;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Normalises a Playwright Cookie into our StoredCookie format.
 */
function normaliseCookie(cookie: Cookie): StoredCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: normaliseSameSite(cookie.sameSite),
  };
}

function normaliseSameSite(value: string): 'Strict' | 'Lax' | 'None' {
  switch (value) {
    case 'Strict':
      return 'Strict';
    case 'Lax':
      return 'Lax';
    case 'None':
      return 'None';
    default:
      return 'Lax';
  }
}
