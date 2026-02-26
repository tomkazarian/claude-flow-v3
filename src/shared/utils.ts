/**
 * General-purpose utility functions used across every module.
 * All functions are pure (no side effects, no I/O) unless noted.
 */

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

/**
 * Converts arbitrary text into a URL-safe slug.
 * Example: "Win a $500 Gift Card!" -> "win-a-500-gift-card"
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')   // strip non-word chars (except hyphens)
    .replace(/[\s_]+/g, '-')    // collapse whitespace / underscores -> hyphen
    .replace(/-+/g, '-')        // collapse consecutive hyphens
    .replace(/^-+|-+$/g, '');   // trim leading/trailing hyphens
}

/**
 * Truncates text to `maxLen` characters, appending an ellipsis if shortened.
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.slice(0, maxLen - 1) + '\u2026'; // unicode ellipsis
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

/**
 * Returns true if the date string represents a date in the past.
 * Returns false if the string cannot be parsed.
 */
export function isExpired(dateStr: string): boolean {
  const parsed = parseDate(dateStr);
  if (!parsed) {
    return false;
  }
  return parsed.getTime() < Date.now();
}

/**
 * Attempts to parse a date string in several common formats:
 *  - ISO 8601 ("2025-03-15T00:00:00Z")
 *  - US format ("03/15/2025", "March 15, 2025")
 *  - "15 Mar 2025", "Mar 15, 2025"
 * Returns null if parsing fails.
 */
export function parseDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  const trimmed = dateStr.trim();

  // ISO 8601 or anything the Date constructor handles natively
  const native = new Date(trimmed);
  if (!isNaN(native.getTime())) {
    return native;
  }

  // Try MM/DD/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(d.getTime())) {
      return d;
    }
  }

  // Try DD-MM-YYYY
  const dashMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    const [, day, month, year] = dashMatch;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(d.getTime())) {
      return d;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Formats a number as US currency. Example: 1500 -> "$1,500.00"
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

// ---------------------------------------------------------------------------
// URL utilities
// ---------------------------------------------------------------------------

/** Tracking parameters commonly appended by analytics and ad platforms. */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  '_ga',
  '_gl',
  'yclid',
  'twclid',
]);

/**
 * Normalizes a URL by removing tracking parameters, lowercasing the
 * host, removing default ports, and stripping trailing slashes.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Remove tracking params
    for (const param of TRACKING_PARAMS) {
      parsed.searchParams.delete(param);
    }

    // Sort remaining params for consistent comparison
    parsed.searchParams.sort();

    // Lowercase host
    parsed.hostname = parsed.hostname.toLowerCase();

    // Remove trailing slash from pathname (but keep "/" for root)
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    // Remove hash fragment
    parsed.hash = '';

    return parsed.toString();
  } catch {
    // If the URL is malformed, return it as-is
    return url;
  }
}

/**
 * Extracts the bare domain from a URL. Example: "https://www.example.com/path" -> "example.com"
 */
export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Array utilities
// ---------------------------------------------------------------------------

/**
 * Returns a random element from the array.
 * Throws if the array is empty.
 */
export function pickRandom<T>(arr: readonly T[]): T {
  if (arr.length === 0) {
    throw new Error('Cannot pick from an empty array');
  }
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/**
 * Returns a new array with elements in random order (Fisher-Yates shuffle).
 * Does NOT mutate the original array.
 */
export function shuffleArray<T>(arr: readonly T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/**
 * Splits an array into chunks of the given size.
 * The last chunk may be smaller if the array length is not evenly divisible.
 */
export function chunkArray<T>(arr: readonly T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be a positive integer');
  }
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Function utilities
// ---------------------------------------------------------------------------

/**
 * Creates a debounced version of `fn` that delays invocation until
 * `ms` milliseconds have elapsed since the last call.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return (...args: Parameters<T>): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      fn(...args);
      timer = undefined;
    }, ms);
  };
}
