/**
 * Checkbox handler for terms acceptance, age verification,
 * newsletter opt-ins, and data sharing consent.
 *
 * Analyzes label text to classify each checkbox and determines
 * whether to check it based on configuration.
 */

import { getLogger } from '../shared/logger.js';
import { humanClickDelay } from '../shared/timing.js';
import type { Page } from './types.js';

const log = getLogger('entry', { component: 'checkbox-handler' });

// ---------------------------------------------------------------------------
// Checkbox classification patterns
// ---------------------------------------------------------------------------

type CheckboxCategory = 'terms' | 'age-verify' | 'newsletter' | 'data-sharing' | 'bonus-entry' | 'unknown';

interface CheckboxClassification {
  selector: string;
  category: CheckboxCategory;
  labelText: string;
  shouldCheck: boolean;
}

/** Patterns for detecting terms/rules agreement checkboxes. */
const TERMS_PATTERNS = [
  /\bterms\b/i, /\brules\b/i, /\bagree\b/i, /\baccept\b/i,
  /\bconditions\b/i, /\bofficial rules\b/i, /\bterms of service\b/i,
  /\bterms & conditions\b/i, /\bterms and conditions\b/i,
  /\bi have read\b/i, /\bi acknowledge\b/i,
];

/** Patterns for age verification checkboxes. */
const AGE_PATTERNS = [
  /\b18\+\b/, /\b18 or older\b/i, /\b21\+\b/, /\b21 or older\b/i,
  /\bage\b.*\brequirement\b/i, /\bof legal age\b/i,
  /\bconfirm.*\bage\b/i, /\bverify.*\bage\b/i,
  /\b13 or older\b/i, /\b13\+\b/,
];

/** Patterns for newsletter subscription checkboxes. */
const NEWSLETTER_PATTERNS = [
  /\bnewsletter\b/i, /\bsubscribe\b/i, /\bemail.*updates?\b/i,
  /\bsign.*up.*email\b/i, /\breceive.*emails?\b/i,
  /\bopt.*in.*email\b/i, /\bmarketing.*emails?\b/i,
  /\bpromotional\b/i, /\bspecial offers\b/i,
];

/** Patterns for data sharing checkboxes. */
const DATA_SHARING_PATTERNS = [
  /\bshare.*data\b/i, /\bshare.*information\b/i,
  /\bthird.?part(?:y|ies)\b/i, /\bpartners?\b/i,
  /\baffiliate\b/i, /\bshare.*with\b/i,
  /\bsponsor.*contact\b/i,
];

/** Patterns for bonus entry checkboxes. */
const BONUS_ENTRY_PATTERNS = [
  /\bbonus\b.*\bentr(?:y|ies)\b/i, /\bextra\b.*\bentr(?:y|ies)\b/i,
  /\badditional\b.*\bentr(?:y|ies)\b/i, /\bdouble\b.*\bentr(?:y|ies)\b/i,
  /\bbonus\b/i,
];

export interface CheckboxOptions {
  /** Whether to check newsletter boxes for bonus entries (default: true). */
  checkNewsletterForBonus: boolean;
  /** Whether to share data with partners (default: false). */
  shareDataWithPartners: boolean;
}

const DEFAULT_OPTIONS: CheckboxOptions = {
  checkNewsletterForBonus: true,
  shareDataWithPartners: false,
};

export class CheckboxHandler {
  /**
   * Find and handle all checkboxes on the page.
   */
  async handleCheckboxes(
    page: Page,
    options: Partial<CheckboxOptions> = {},
  ): Promise<void> {
    const opts: CheckboxOptions = { ...DEFAULT_OPTIONS, ...options };

    log.info('Handling checkboxes on page');

    const checkboxes = await this.detectCheckboxes(page);
    const classified = this.classifyCheckboxes(checkboxes, opts);

    let checkedCount = 0;

    for (const checkbox of classified) {
      if (checkbox.shouldCheck) {
        try {
          await this.checkCheckbox(page, checkbox.selector);
          checkedCount++;
          log.debug(
            { selector: checkbox.selector, category: checkbox.category },
            'Checkbox checked',
          );
        } catch (error) {
          log.error(
            {
              selector: checkbox.selector,
              category: checkbox.category,
              error: error instanceof Error ? error.message : String(error),
            },
            'Failed to check checkbox',
          );
        }
      } else {
        log.debug(
          { selector: checkbox.selector, category: checkbox.category },
          'Skipping checkbox',
        );
      }
    }

    log.info(
      { total: classified.length, checked: checkedCount },
      'Checkbox handling complete',
    );
  }

  /**
   * Detect all checkboxes on the page and extract their label text.
   */
  private async detectCheckboxes(
    page: Page,
  ): Promise<Array<{ selector: string; labelText: string }>> {
    try {
      const checkboxes = await page.evaluate(() => {
        const result: Array<{ selector: string; labelText: string }> = [];
        const inputs = document.querySelectorAll('input[type="checkbox"]');

        inputs.forEach((input) => {
          const checkbox = input as HTMLInputElement;
          const id = checkbox.id;
          const name = checkbox.name;

          let selector = '';
          if (id) {
            selector = `#${CSS.escape(id)}`;
          } else if (name) {
            selector = `input[type="checkbox"][name="${CSS.escape(name)}"]`;
          } else {
            return; // Cannot reliably target
          }

          // Extract label text
          let labelText = '';

          // Check for <label for="id">
          if (id) {
            const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (label) {
              labelText = label.textContent?.trim() ?? '';
            }
          }

          // Check for parent <label>
          if (!labelText) {
            const parentLabel = checkbox.closest('label');
            if (parentLabel) {
              labelText = parentLabel.textContent?.trim() ?? '';
            }
          }

          // Check for adjacent text
          if (!labelText) {
            const nextSibling = checkbox.nextSibling;
            if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE) {
              labelText = nextSibling.textContent?.trim() ?? '';
            }
          }

          // Check for next element sibling
          if (!labelText) {
            const nextEl = checkbox.nextElementSibling;
            if (nextEl) {
              labelText = nextEl.textContent?.trim() ?? '';
            }
          }

          // Check aria-label
          if (!labelText) {
            labelText = checkbox.getAttribute('aria-label') ?? '';
          }

          result.push({ selector, labelText });
        });

        return result;
      }) as Array<{ selector: string; labelText: string }>;

      return checkboxes;
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to detect checkboxes',
      );
      return [];
    }
  }

  /**
   * Classify each checkbox by its purpose and decide whether to check it.
   */
  private classifyCheckboxes(
    checkboxes: Array<{ selector: string; labelText: string }>,
    options: CheckboxOptions,
  ): CheckboxClassification[] {
    return checkboxes.map(({ selector, labelText }) => {
      const category = this.categorize(labelText);
      const shouldCheck = this.shouldCheck(category, labelText, options);

      return { selector, category, labelText, shouldCheck };
    });
  }

  /**
   * Categorize a checkbox based on its label text.
   */
  private categorize(labelText: string): CheckboxCategory {
    // Check for terms/rules first (highest priority)
    for (const pattern of TERMS_PATTERNS) {
      if (pattern.test(labelText)) {
        return 'terms';
      }
    }

    // Age verification
    for (const pattern of AGE_PATTERNS) {
      if (pattern.test(labelText)) {
        return 'age-verify';
      }
    }

    // Bonus entry
    for (const pattern of BONUS_ENTRY_PATTERNS) {
      if (pattern.test(labelText)) {
        return 'bonus-entry';
      }
    }

    // Data sharing
    for (const pattern of DATA_SHARING_PATTERNS) {
      if (pattern.test(labelText)) {
        return 'data-sharing';
      }
    }

    // Newsletter
    for (const pattern of NEWSLETTER_PATTERNS) {
      if (pattern.test(labelText)) {
        return 'newsletter';
      }
    }

    return 'unknown';
  }

  /**
   * Determine whether a checkbox should be checked.
   */
  private shouldCheck(
    category: CheckboxCategory,
    _labelText: string,
    options: CheckboxOptions,
  ): boolean {
    switch (category) {
      case 'terms':
        // Always check terms/rules agreement
        return true;

      case 'age-verify':
        // Always check age verification
        return true;

      case 'bonus-entry':
        // Always check bonus entry opportunities
        return true;

      case 'newsletter':
        // Check if configured to opt in for bonus entries
        return options.checkNewsletterForBonus;

      case 'data-sharing':
        // Check only if configured to share data
        return options.shareDataWithPartners;

      case 'unknown':
        // Skip unknown checkboxes by default
        return false;
    }
  }

  /**
   * Check a single checkbox with human-like interaction.
   */
  private async checkCheckbox(page: Page, selector: string): Promise<void> {
    await humanClickDelay();

    try {
      const isChecked = await page.isChecked(selector);
      if (!isChecked) {
        await page.check(selector);
      }
    } catch {
      // Fall back to clicking
      try {
        await page.click(selector);
      } catch {
        // Try clicking the associated label
        await page.evaluate(
          (sel: unknown) => {
            const input = document.querySelector(sel as string) as HTMLInputElement | null;
            if (!input) return;

            const id = input.id;
            if (id) {
              const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
              if (label) {
                (label as HTMLElement).click();
                return;
              }
            }

            const parentLabel = input.closest('label');
            if (parentLabel) {
              (parentLabel as HTMLElement).click();
              return;
            }

            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          },
          selector,
        );
      }
    }
  }
}
