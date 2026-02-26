/**
 * Confirmation handler for post-submission result detection.
 *
 * Analyzes the page after form submission to detect success/failure
 * indicators, extract confirmation numbers, and capture screenshots.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getLogger } from '../shared/logger.js';
import { PATHS } from '../shared/constants.js';
import { sleep } from '../shared/timing.js';
import type { Page, ConfirmationResult } from './types.js';

const log = getLogger('entry', { component: 'confirmation-handler' });

const RESULT_DETECTION_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Success indicator patterns
// ---------------------------------------------------------------------------

const SUCCESS_PATTERNS = [
  /thank\s*you/i,
  /entry\s*received/i,
  /entry\s*confirmed/i,
  /successfully\s*(?:entered|submitted|registered)/i,
  /you(?:'re|\s*are)\s*(?:now\s*)?entered/i,
  /good\s*luck/i,
  /entry\s*complete/i,
  /confirmation/i,
  /you(?:'ve|\s*have)\s*been\s*entered/i,
  /we(?:'ve|\s*have)\s*received\s*your/i,
  /submission\s*complete/i,
  /registration\s*complete/i,
  /entry\s*#\s*\d+/i,
];

// ---------------------------------------------------------------------------
// Failure indicator patterns
// ---------------------------------------------------------------------------

const FAILURE_PATTERNS = [
  /\berror\b/i,
  /something\s*went\s*wrong/i,
  /already\s*entered/i,
  /not\s*eligible/i,
  /ineligible/i,
  /expired/i,
  /this\s*(?:contest|sweepstakes)\s*(?:has\s*)?ended/i,
  /submission\s*failed/i,
  /unable\s*to\s*(?:process|submit)/i,
  /please\s*try\s*again/i,
  /invalid\s*(?:entry|submission)/i,
  /limit\s*(?:reached|exceeded)/i,
  /you(?:'ve|\s*have)\s*already\s*entered/i,
  /duplicate\s*entry/i,
  /maximum\s*entries?\s*reached/i,
];

// ---------------------------------------------------------------------------
// "Already entered" patterns (subset of failure, but different status)
// ---------------------------------------------------------------------------

const ALREADY_ENTERED_PATTERNS = [
  /already\s*entered/i,
  /you(?:'ve|\s*have)\s*already/i,
  /duplicate\s*entry/i,
  /maximum\s*entries?\s*reached/i,
  /limit\s*(?:reached|exceeded)/i,
];

// ---------------------------------------------------------------------------
// Confirmation number patterns
// ---------------------------------------------------------------------------

const CONFIRMATION_PATTERNS = [
  /(?:confirmation|entry|reference|receipt)\s*(?:#|number|no\.?|code)[:\s]*([A-Z0-9-]{4,20})/i,
  /(?:entry|confirmation)\s*#\s*(\d+)/i,
  /(?:your|entry)\s*(?:id|number)[:\s]*([A-Z0-9-]{4,20})/i,
  /(?:ref|transaction)\s*(?:id|number|#|:)[:\s]*([A-Z0-9-]{4,20})/i,
];

export class ConfirmationHandler {
  /**
   * Handle the post-submission confirmation page.
   * Detects success or failure, extracts confirmation numbers,
   * and takes a screenshot.
   */
  async handleConfirmation(
    page: Page,
    entryId: string,
  ): Promise<ConfirmationResult> {
    log.info({ entryId }, 'Handling post-submission confirmation');

    // Wait for the result page to stabilize
    await this.waitForResultPage(page);

    // Get the page text
    const pageText = await this.getPageText(page);

    // Take screenshot first (before any analysis errors)
    const screenshotPath = await this.takeScreenshot(page, entryId);

    // Check for already entered (specific failure type)
    for (const pattern of ALREADY_ENTERED_PATTERNS) {
      if (pattern.test(pageText)) {
        const message = this.extractMessage(pageText, pattern);
        log.info({ entryId, message }, 'Already entered detected');
        return {
          success: false,
          message: message || 'Already entered this contest',
          screenshotPath,
        };
      }
    }

    // Check for success
    for (const pattern of SUCCESS_PATTERNS) {
      if (pattern.test(pageText)) {
        const message = this.extractMessage(pageText, pattern);
        const confirmationNumber = this.extractConfirmationNumber(pageText);

        log.info(
          { entryId, confirmationNumber, message },
          'Entry confirmed successful',
        );

        return {
          success: true,
          message: message || 'Entry submitted successfully',
          confirmationNumber: confirmationNumber ?? undefined,
          screenshotPath,
        };
      }
    }

    // Check for failure
    for (const pattern of FAILURE_PATTERNS) {
      if (pattern.test(pageText)) {
        const message = this.extractMessage(pageText, pattern);
        log.warn({ entryId, message }, 'Entry failure detected');
        return {
          success: false,
          message: message || 'Entry submission failed',
          screenshotPath,
        };
      }
    }

    // If we cannot determine success or failure, assume success
    // if the page loaded without errors
    log.info({ entryId }, 'Could not determine result, assuming success');
    return {
      success: true,
      message: 'Entry submitted (confirmation status uncertain)',
      screenshotPath,
    };
  }

  /**
   * Wait for the result page to finish loading.
   */
  private async waitForResultPage(page: Page): Promise<void> {
    try {
      await page.waitForLoadState('networkidle', { timeout: RESULT_DETECTION_TIMEOUT_MS });
    } catch {
      // Timeout is acceptable; proceed with whatever we have
    }

    // Additional wait for dynamic content
    await sleep(2_000);
  }

  /**
   * Get the text content of the page body.
   */
  private async getPageText(page: Page): Promise<string> {
    try {
      const text = await page.evaluate(() => {
        return document.body.textContent ?? '';
      }) as string;
      return text.replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }

  /**
   * Take a screenshot of the confirmation page.
   */
  private async takeScreenshot(page: Page, entryId: string): Promise<string> {
    const screenshotDir = PATHS.SCREENSHOTS;

    try {
      if (!existsSync(screenshotDir)) {
        mkdirSync(screenshotDir, { recursive: true });
      }
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to create screenshots directory',
      );
    }

    const filename = `entry_${entryId}_${Date.now()}.png`;
    const filepath = join(screenshotDir, filename);

    try {
      await page.screenshot({
        path: filepath,
        fullPage: false,
        type: 'png',
      });
      log.debug({ filepath }, 'Screenshot saved');
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to take screenshot',
      );
    }

    return filepath;
  }

  /**
   * Extract a human-readable message around a matched pattern.
   */
  private extractMessage(text: string, pattern: RegExp): string {
    const match = text.match(pattern);
    if (!match) return '';

    const matchIndex = text.indexOf(match[0]);
    if (matchIndex === -1) return match[0];

    // Get surrounding context
    const start = Math.max(0, matchIndex - 20);
    const end = Math.min(text.length, matchIndex + match[0].length + 80);
    let message = text.slice(start, end).trim();

    // Clean up: trim to sentence boundary
    const sentenceEnd = message.indexOf('.', match[0].length);
    if (sentenceEnd > 0 && sentenceEnd < 120) {
      message = message.slice(0, sentenceEnd + 1);
    }

    // Remove leading partial words
    if (start > 0) {
      const spaceIndex = message.indexOf(' ');
      if (spaceIndex > 0 && spaceIndex < 15) {
        message = message.slice(spaceIndex + 1);
      }
    }

    return message.trim();
  }

  /**
   * Extract a confirmation number from the page text.
   */
  private extractConfirmationNumber(text: string): string | null {
    for (const pattern of CONFIRMATION_PATTERNS) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return null;
  }
}
