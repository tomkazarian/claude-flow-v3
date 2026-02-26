/**
 * Handles clicking confirmation links from email to verify sweepstakes entries.
 *
 * Opens confirmation URLs in a headless browser, waits for success indicators,
 * and reports confirmation status back through the event bus.
 */

import type { BrowserContext, Page } from 'playwright';
import { getLogger } from '../shared/logger.js';
import { eventBus } from '../shared/events.js';
import { retry } from '../shared/retry.js';
import { sleep } from '../shared/timing.js';
import type { ConfirmationEmail } from './email-monitor.js';

const logger = getLogger('email', { component: 'confirmation-clicker' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the browser pool so we avoid a hard circular
 * dependency on the browser module.
 */
export interface BrowserPool {
  acquireContext(): Promise<BrowserContext>;
  releaseContext(context: BrowserContext): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUCCESS_INDICATORS = [
  'confirmed',
  'verified',
  'success',
  'thank you',
  'entry complete',
  'you are now entered',
  'email has been confirmed',
  'verification complete',
  'successfully verified',
  'your entry has been received',
  'you have been entered',
];

const FAILURE_INDICATORS = [
  'expired',
  'invalid link',
  'link has expired',
  'no longer valid',
  'already confirmed',
  'error occurred',
  'something went wrong',
];

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const CONFIRMATION_CHECK_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// ConfirmationClicker
// ---------------------------------------------------------------------------

export class ConfirmationClicker {
  /**
   * Opens a confirmation URL in a headless browser context, waits for
   * the page to load, checks for success indicators, and returns whether
   * the confirmation succeeded.
   */
  async confirmEntry(
    confirmationUrl: string,
    browserPool: BrowserPool,
  ): Promise<boolean> {
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      context = await browserPool.acquireContext();
      page = await context.newPage();

      logger.info({ url: confirmationUrl }, 'Opening confirmation URL');

      // Navigate to the confirmation URL
      const response = await page.goto(confirmationUrl, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_LOAD_TIMEOUT_MS,
      });

      if (!response) {
        logger.warn({ url: confirmationUrl }, 'No response from confirmation URL');
        return false;
      }

      const status = response.status();
      if (status >= 400) {
        logger.warn(
          { url: confirmationUrl, status },
          'Confirmation URL returned error status',
        );
        return false;
      }

      // Wait for the page to stabilize
      await sleep(2000);

      // Handle potential redirects - wait for navigation to settle
      await page.waitForLoadState('networkidle', {
        timeout: CONFIRMATION_CHECK_TIMEOUT_MS,
      }).catch(() => {
        // Network idle timeout is acceptable - page may still be functional
        logger.debug('Network idle timeout, continuing with check');
      });

      // Check page content for success/failure indicators
      const confirmed = await this.checkPageForConfirmation(page);

      if (confirmed) {
        logger.info({ url: confirmationUrl }, 'Entry confirmed successfully');
      } else {
        // Try clicking any confirm/verify buttons on the page
        const clickResult = await this.tryClickConfirmButton(page);
        if (clickResult) {
          logger.info(
            { url: confirmationUrl },
            'Entry confirmed after clicking button',
          );
          return true;
        }

        logger.warn(
          { url: confirmationUrl },
          'Could not confirm entry - no success indicators found',
        );
      }

      return confirmed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { url: confirmationUrl, err: error },
        `Confirmation failed: ${message}`,
      );
      return false;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
      if (context) {
        await browserPool.releaseContext(context).catch(() => {});
      }
    }
  }

  /**
   * Processes a confirmation email by extracting the URL and confirming it.
   * Emits 'email:confirmed' on success.
   */
  async processConfirmationEmail(
    email: ConfirmationEmail,
    browserPool: BrowserPool,
  ): Promise<boolean> {
    if (!email.confirmationUrl) {
      logger.warn(
        { emailId: email.emailId },
        'Confirmation email has no URL to click',
      );
      return false;
    }

    logger.info(
      {
        emailId: email.emailId,
        subject: email.subject,
        url: email.confirmationUrl,
      },
      'Processing confirmation email',
    );

    const confirmed = await retry(
      () => this.confirmEntry(email.confirmationUrl, browserPool),
      {
        maxAttempts: 2,
        baseDelayMs: 5000,
        retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'Navigation timeout'],
      },
    );

    if (confirmed) {
      eventBus.emit('email:confirmed', {
        entryId: email.entryId ?? '',
        emailId: email.emailId,
      });
    }

    return confirmed;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Reads the visible text content of the page and checks for success
   * or failure indicators.
   */
  private async checkPageForConfirmation(page: Page): Promise<boolean> {
    try {
      const bodyText = await page.evaluate(() =>
        document.body?.innerText?.toLowerCase() ?? '',
      );

      // Check for failure first
      for (const indicator of FAILURE_INDICATORS) {
        if (bodyText.includes(indicator)) {
          logger.debug(
            { indicator },
            'Failure indicator found on confirmation page',
          );
          return false;
        }
      }

      // Check for success
      for (const indicator of SUCCESS_INDICATORS) {
        if (bodyText.includes(indicator)) {
          logger.debug(
            { indicator },
            'Success indicator found on confirmation page',
          );
          return true;
        }
      }

      // Check the page title as well
      const title = await page.title();
      const titleLower = title.toLowerCase();
      for (const indicator of SUCCESS_INDICATORS) {
        if (titleLower.includes(indicator)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.warn({ err: error }, 'Error checking page content');
      return false;
    }
  }

  /**
   * Attempts to find and click a confirmation/verify button on the page.
   * Some confirmation pages require an explicit button click.
   */
  private async tryClickConfirmButton(page: Page): Promise<boolean> {
    const buttonSelectors = [
      'button:has-text("Confirm")',
      'button:has-text("Verify")',
      'button:has-text("Complete")',
      'button:has-text("Submit")',
      'a:has-text("Confirm")',
      'a:has-text("Verify")',
      'a:has-text("Click here to confirm")',
      'input[type="submit"][value*="confirm" i]',
      'input[type="submit"][value*="verify" i]',
    ];

    for (const selector of buttonSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          await element.click();
          logger.debug({ selector }, 'Clicked confirmation button');

          // Wait for navigation or content change
          await sleep(3000);
          await page.waitForLoadState('networkidle', {
            timeout: 10_000,
          }).catch(() => {});

          // Re-check page for success
          const confirmed = await this.checkPageForConfirmation(page);
          if (confirmed) {
            return true;
          }
        }
      } catch {
        // Selector not found or click failed - try next
        continue;
      }
    }

    return false;
  }
}
