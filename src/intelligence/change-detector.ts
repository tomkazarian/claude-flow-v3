/**
 * Site change detector.
 *
 * Compares the current page structure against stored form_mapping selectors
 * to detect when a contest site has changed its layout, breaking existing
 * entry automation.
 */

import { eq } from 'drizzle-orm';
import { getLogger } from '../shared/logger.js';
import { getDb, schema } from '../db/index.js';

const log = getLogger('queue', { component: 'change-detector' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangeResult {
  /** Whether any tracked selectors are broken. */
  changed: boolean;
  /** Selectors from the stored mapping that are no longer found in the page. */
  brokenSelectors: string[];
  /** New form-related selectors found in the page that were not in the mapping. */
  newSelectors: string[];
  /** Total selectors checked. */
  totalChecked: number;
  /** Percentage of selectors still working (0-100). */
  healthPercent: number;
}

// ---------------------------------------------------------------------------
// ChangeDetector
// ---------------------------------------------------------------------------

export class ChangeDetector {
  /**
   * Checks the current page HTML against stored form mappings for a contest.
   *
   * @param contestUrl - The URL of the contest to check.
   * @param currentHtml - The current HTML content of the contest page.
   * @returns A ChangeResult indicating whether selectors are broken.
   */
  checkForChanges(contestUrl: string, currentHtml: string): ChangeResult {
    const storedMapping = this.getStoredMapping(contestUrl);

    if (!storedMapping || Object.keys(storedMapping).length === 0) {
      log.debug({ contestUrl }, 'No stored mapping found, cannot detect changes');
      return {
        changed: false,
        brokenSelectors: [],
        newSelectors: [],
        totalChecked: 0,
        healthPercent: 100,
      };
    }

    const storedSelectors = Object.keys(storedMapping);
    const brokenSelectors: string[] = [];

    // Check each stored selector against the current HTML
    for (const selector of storedSelectors) {
      if (!selectorExistsInHtml(selector, currentHtml)) {
        brokenSelectors.push(selector);
      }
    }

    // Detect new form-related elements not in the stored mapping
    const newSelectors = findNewFormSelectors(currentHtml, storedSelectors);

    const totalChecked = storedSelectors.length;
    const workingCount = totalChecked - brokenSelectors.length;
    const healthPercent =
      totalChecked > 0 ? Math.round((workingCount / totalChecked) * 100) : 100;

    const changed = brokenSelectors.length > 0;

    if (changed) {
      log.warn(
        {
          contestUrl,
          brokenCount: brokenSelectors.length,
          totalChecked,
          healthPercent,
          brokenSelectors: brokenSelectors.slice(0, 5),
        },
        'Contest page layout change detected',
      );

      // Update contest in database to flag the change
      this.flagContestChanged(contestUrl, brokenSelectors).catch((err) => {
        log.error({ err, contestUrl }, 'Failed to flag contest as changed');
      });
    } else {
      log.debug(
        { contestUrl, totalChecked, healthPercent },
        'No layout changes detected',
      );
    }

    return {
      changed,
      brokenSelectors,
      newSelectors,
      totalChecked,
      healthPercent,
    };
  }

  /**
   * Checks multiple contests in batch.
   */
  checkMultiple(
    contestPages: Array<{ contestUrl: string; currentHtml: string }>,
  ): Map<string, ChangeResult> {
    const results = new Map<string, ChangeResult>();

    for (const { contestUrl, currentHtml } of contestPages) {
      const result = this.checkForChanges(contestUrl, currentHtml);
      results.set(contestUrl, result);
    }

    const changedCount = Array.from(results.values()).filter((r) => r.changed).length;
    log.info(
      {
        totalChecked: contestPages.length,
        changedCount,
        unchangedCount: contestPages.length - changedCount,
      },
      'Batch change detection completed',
    );

    return results;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Retrieves the stored form mapping for a contest URL.
   */
  private getStoredMapping(contestUrl: string): Record<string, string> | null {
    const db = getDb();

    const rows = db
      .select({ formMapping: schema.contests.formMapping })
      .from(schema.contests)
      .where(eq(schema.contests.url, contestUrl))
      .limit(1)
      .all();

    const row = rows[0];
    if (!row?.formMapping || row.formMapping === '{}') {
      return null;
    }

    try {
      return JSON.parse(row.formMapping) as Record<string, string>;
    } catch {
      log.debug({ contestUrl }, 'Failed to parse stored form mapping');
      return null;
    }
  }

  /**
   * Flags a contest as needing attention due to layout changes.
   */
  private async flagContestChanged(
    contestUrl: string,
    brokenSelectors: string[],
  ): Promise<void> {
    const db = getDb();

    const contests = await db
      .select({ id: schema.contests.id, metadata: schema.contests.metadata })
      .from(schema.contests)
      .where(eq(schema.contests.url, contestUrl))
      .limit(1);

    const contest = contests[0];
    if (!contest) return;

    let metadata: Record<string, unknown> = {};
    try {
      metadata = contest.metadata
        ? (JSON.parse(contest.metadata) as Record<string, unknown>)
        : {};
    } catch {
      // Ignore parse errors
    }

    metadata['layoutChangeDetected'] = true;
    metadata['layoutChangeAt'] = new Date().toISOString();
    metadata['brokenSelectors'] = brokenSelectors;

    await db
      .update(schema.contests)
      .set({
        metadata: JSON.stringify(metadata),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.contests.id, contest.id));
  }
}

// ---------------------------------------------------------------------------
// HTML analysis utilities
// ---------------------------------------------------------------------------

/**
 * Checks if a CSS selector likely matches an element in the given HTML.
 *
 * This uses heuristic string matching rather than a full DOM parser
 * for performance. For high-accuracy checks, use cheerio or jsdom.
 */
function selectorExistsInHtml(selector: string, html: string): boolean {
  // Handle ID selectors: #foo -> id="foo"
  const idMatch = selector.match(/^#([\w-]+)/);
  if (idMatch?.[1]) {
    return html.includes(`id="${idMatch[1]}"`) || html.includes(`id='${idMatch[1]}'`);
  }

  // Handle class selectors: .foo -> class="...foo..."
  const classMatch = selector.match(/^\.([\w-]+)/);
  if (classMatch?.[1]) {
    return html.includes(classMatch[1]);
  }

  // Handle name attribute selectors: [name="foo"]
  const nameMatch = selector.match(/\[name=["']?([\w-]+)["']?\]/);
  if (nameMatch?.[1]) {
    return html.includes(`name="${nameMatch[1]}"`) || html.includes(`name='${nameMatch[1]}'`);
  }

  // Handle type attribute selectors: input[type="email"]
  const typeMatch = selector.match(/\[type=["']?([\w-]+)["']?\]/);
  if (typeMatch?.[1]) {
    return html.includes(`type="${typeMatch[1]}"`) || html.includes(`type='${typeMatch[1]}'`);
  }

  // Handle tag selectors: form, input, select, textarea
  const tagMatch = selector.match(/^(\w+)/);
  if (tagMatch?.[1]) {
    const tag = tagMatch[1].toLowerCase();
    return html.toLowerCase().includes(`<${tag}`);
  }

  // Fallback: check if the raw selector text appears anywhere
  return html.includes(selector);
}

/**
 * Finds form-related HTML elements in the current page that are NOT
 * in the stored selector list. These may represent new fields added
 * to the contest form.
 */
function findNewFormSelectors(
  html: string,
  storedSelectors: string[],
): string[] {
  const newSelectors: string[] = [];
  const storedSet = new Set(storedSelectors);

  // Extract input name attributes
  const inputNameRegex = /<input[^>]*\sname=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = inputNameRegex.exec(html)) !== null) {
    if (match[1]) {
      const selector = `input[name="${match[1]}"]`;
      if (!storedSet.has(selector) && !isCommonHiddenField(match[1])) {
        newSelectors.push(selector);
      }
    }
  }

  // Extract select name attributes
  const selectNameRegex = /<select[^>]*\sname=["']([^"']+)["'][^>]*>/gi;
  while ((match = selectNameRegex.exec(html)) !== null) {
    if (match[1]) {
      const selector = `select[name="${match[1]}"]`;
      if (!storedSet.has(selector)) {
        newSelectors.push(selector);
      }
    }
  }

  // Extract textarea name attributes
  const textareaNameRegex = /<textarea[^>]*\sname=["']([^"']+)["'][^>]*>/gi;
  while ((match = textareaNameRegex.exec(html)) !== null) {
    if (match[1]) {
      const selector = `textarea[name="${match[1]}"]`;
      if (!storedSet.has(selector)) {
        newSelectors.push(selector);
      }
    }
  }

  return newSelectors;
}

/**
 * Returns true if the field name is a common hidden/tracking field
 * that should be ignored during change detection.
 */
function isCommonHiddenField(name: string): boolean {
  const hiddenPatterns = [
    /^_token$/i,
    /^csrf/i,
    /^__/,
    /^_method$/i,
    /^honeypot/i,
    /^_ga/i,
    /^utm_/i,
    /^g-recaptcha/i,
    /^h-captcha/i,
  ];

  return hiddenPatterns.some((pattern) => pattern.test(name));
}
