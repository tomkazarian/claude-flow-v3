/**
 * Simple form entry strategy.
 *
 * Handles single-page form entries: navigate to the contest URL,
 * analyze the form, fill fields, handle checkboxes, solve CAPTCHA
 * if present, submit, and confirm.
 */

import { getLogger } from '../../shared/logger.js';
import { eventBus } from '../../shared/events.js';
import { EntryError } from '../../shared/errors.js';
import { ENTRY_STATUSES, DEFAULT_LIMITS } from '../../shared/constants.js';
import { humanClickDelay, humanPageLoadWait } from '../../shared/timing.js';
import { FormAnalyzer } from '../form-analyzer.js';
import { FormFiller } from '../form-filler.js';
import { CheckboxHandler } from '../checkbox-handler.js';
import { ConfirmationHandler } from '../confirmation-handler.js';
import { detectCaptcha } from '../../captcha/captcha-detector.js';
import { CaptchaSolver } from '../../captcha/captcha-solver.js';
import type { EntryStrategy, EntryContext, EntryResult } from '../types.js';
import type { Page as PlaywrightPage } from 'playwright';

const log = getLogger('entry', { component: 'simple-form-strategy' });

export class SimpleFormStrategy implements EntryStrategy {
  readonly name = 'simple-form';

  private readonly formAnalyzer = new FormAnalyzer();
  private readonly formFiller = new FormFiller();
  private readonly checkboxHandler = new CheckboxHandler();
  private readonly confirmationHandler = new ConfirmationHandler();

  /**
   * Execute the simple form entry strategy.
   */
  async execute(context: EntryContext): Promise<EntryResult> {
    const { page, contest, profile, options, entryId } = context;
    const startTime = Date.now();
    const errors: string[] = [];

    log.info(
      { entryId, contestId: contest.id, url: contest.url },
      'Executing simple form strategy',
    );

    eventBus.emit('entry:started', {
      contestId: contest.id,
      profileId: profile.id,
      entryId,
    });

    try {
      // Step 1: Navigate to the contest URL
      log.debug({ url: contest.url }, 'Navigating to contest URL');
      await page.goto(contest.url, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_LIMITS.PAGE_LOAD_TIMEOUT_MS,
      });
      await humanPageLoadWait();

      // Step 2: Analyze the form
      log.debug('Analyzing form');
      const analysis = await this.formAnalyzer.analyzeForm(page);

      if (analysis.fields.length === 0) {
        throw new EntryError(
          'No form fields detected on the page',
          'NO_FORM_FIELDS',
          contest.id,
          entryId,
        );
      }

      log.info(
        { fieldCount: analysis.fields.length, hasCaptcha: analysis.hasCaptcha },
        'Form analyzed',
      );

      // Step 3: Fill form fields
      log.debug('Filling form fields');
      await this.formFiller.fillForm(page, analysis, profile);

      // Step 4: Handle checkboxes
      log.debug('Handling checkboxes');
      await this.checkboxHandler.handleCheckboxes(page, {
        checkNewsletterForBonus: options.checkNewsletterForBonus,
        shareDataWithPartners: options.shareDataWithPartners,
      });

      // Step 5: Handle CAPTCHA if present
      if (analysis.hasCaptcha) {
        log.info('CAPTCHA detected, attempting to solve');
        try {
          await this.handleCaptcha(page);
        } catch (captchaError) {
          const msg = captchaError instanceof Error ? captchaError.message : String(captchaError);
          errors.push(`CAPTCHA: ${msg}`);
          log.error({ error: msg }, 'CAPTCHA solving failed, aborting submission');
          throw new EntryError(
            `CAPTCHA solving failed: ${msg}`,
            'CAPTCHA_FAILED',
            contest.id,
            entryId,
          );
        }
      }

      // Step 6: Submit the form
      log.debug({ submitButton: analysis.submitButton }, 'Submitting form');
      await humanClickDelay();
      await page.click(analysis.submitButton);

      // Step 7: Wait for submission result
      try {
        await page.waitForNavigation({ timeout: 15_000 });
      } catch {
        // Some forms submit via AJAX without navigation
        log.debug('No navigation after submit, may be AJAX submission');
      }

      // Step 8: Handle confirmation
      log.debug('Handling confirmation');
      const confirmation = await this.confirmationHandler.handleConfirmation(page, entryId);

      const durationMs = Date.now() - startTime;
      const status = confirmation.success ? ENTRY_STATUSES.CONFIRMED : ENTRY_STATUSES.FAILED;

      const result: EntryResult = {
        entryId,
        contestId: contest.id,
        profileId: profile.id,
        status,
        message: confirmation.message,
        confirmationNumber: confirmation.confirmationNumber,
        screenshotPath: confirmation.screenshotPath,
        timestamp: new Date().toISOString(),
        durationMs,
        errors,
      };

      if (confirmation.success) {
        eventBus.emit('entry:confirmed', { entryId });
      } else {
        eventBus.emit('entry:failed', { entryId, error: confirmation.message });
      }

      log.info(
        { entryId, status, durationMs, confirmationNumber: confirmation.confirmationNumber },
        'Simple form strategy complete',
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startTime;
      errors.push(message);

      // Take failure screenshot
      let screenshotPath: string | undefined;
      try {
        screenshotPath = `./data/screenshots/error_${entryId}_${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: false });
      } catch {
        // Screenshot failure should not mask the original error
        screenshotPath = undefined;
      }

      eventBus.emit('entry:failed', { entryId, error: message });

      log.error({ entryId, error: message, durationMs }, 'Simple form strategy failed');

      return {
        entryId,
        contestId: contest.id,
        profileId: profile.id,
        status: ENTRY_STATUSES.FAILED,
        message,
        screenshotPath,
        timestamp: new Date().toISOString(),
        durationMs,
        errors,
      };
    }
  }

  /**
   * Detect the CAPTCHA type on the page, solve it, and inject the solution.
   * Throws if no solver is available or if solving fails.
   */
  private async handleCaptcha(page: Page): Promise<void> {
    // Detect the CAPTCHA type using the dedicated detector
    const detection = await detectCaptcha(page as unknown as PlaywrightPage);

    if (!detection) {
      log.warn('CAPTCHA was expected but detector found none on the page');
      return;
    }

    log.info({ captchaType: detection.type, siteKey: detection.siteKey }, 'CAPTCHA detected, solving');
    eventBus.emit('captcha:solving', { type: detection.type, provider: 'pending' });

    // Create a solver instance and attempt to solve
    const solver = new CaptchaSolver();

    if (!solver) {
      throw new EntryError(
        'No CaptchaSolver is available. Ensure a CAPTCHA provider API key is configured.',
        'CAPTCHA_NO_SOLVER',
        '',
      );
    }

    // solver.solve will throw CaptchaError if all providers fail or timeout
    await solver.solve(detection, page as unknown as PlaywrightPage);
  }
}

// Re-export the Page type usage for internal private method
type Page = import('../types.js').Page;
