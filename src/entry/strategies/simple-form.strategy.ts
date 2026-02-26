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
import type { EntryStrategy, EntryContext, EntryResult } from '../types.js';

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
          log.error({ error: msg }, 'CAPTCHA solving failed');
          // Continue with submission attempt despite CAPTCHA failure
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
        const screenshotBuffer = await page.screenshot({ fullPage: false });
        if (screenshotBuffer) {
          screenshotPath = `./data/screenshots/error_${entryId}_${Date.now()}.png`;
        }
      } catch {
        // Ignore screenshot errors
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
   * Attempt to handle CAPTCHA on the page.
   * This is a placeholder that emits events for the captcha module to handle.
   */
  private async handleCaptcha(page: Page): Promise<void> {
    eventBus.emit('captcha:solving', { type: 'unknown', provider: 'pending' });

    // Detect CAPTCHA type
    const captchaType = await this.detectCaptchaType(page);
    log.info({ captchaType }, 'CAPTCHA type detected');

    // The actual CAPTCHA solving would be handled by the captcha module.
    // This strategy emits the event and waits for the token to be injected.
    // For now, we log and let the orchestrator handle it.
    log.warn('CAPTCHA solving delegated to captcha module');
  }

  /**
   * Detect the CAPTCHA type on the page.
   */
  private async detectCaptchaType(
    page: import('../types.js').Page,
  ): Promise<string> {
    try {
      const type = await page.evaluate(() => {
        if (document.querySelector('.g-recaptcha') || document.querySelector('iframe[src*="recaptcha"]')) {
          return 'recaptcha-v2';
        }
        if (document.querySelector('.h-captcha') || document.querySelector('iframe[src*="hcaptcha"]')) {
          return 'hcaptcha';
        }
        if (document.querySelector('.cf-turnstile') || document.querySelector('iframe[src*="turnstile"]')) {
          return 'turnstile';
        }
        if (document.querySelector('#captcha') || document.querySelector('.captcha')) {
          return 'image-captcha';
        }
        return 'unknown';
      }) as string;

      return type;
    } catch {
      return 'unknown';
    }
  }
}

// Re-export the Page type usage for internal private method
type Page = import('../types.js').Page;
