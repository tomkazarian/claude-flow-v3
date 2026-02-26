/**
 * Multi-step form entry strategy.
 *
 * Handles wizard-style, paginated, and multi-page entry forms.
 * Navigates through each step, filling forms and clicking next
 * until the final submission.
 */

import { getLogger } from '../../shared/logger.js';
import { eventBus } from '../../shared/events.js';
import { EntryError } from '../../shared/errors.js';
import { ENTRY_STATUSES, DEFAULT_LIMITS } from '../../shared/constants.js';
import { humanPageLoadWait } from '../../shared/timing.js';
import { FormAnalyzer } from '../form-analyzer.js';
import { MultiStepHandler } from '../multi-step-handler.js';
import { CheckboxHandler } from '../checkbox-handler.js';
import { ConfirmationHandler } from '../confirmation-handler.js';
import { detectCaptcha } from '../../captcha/captcha-detector.js';
import { CaptchaSolver } from '../../captcha/captcha-solver.js';
import type { EntryStrategy, EntryContext, EntryResult, Page } from '../types.js';
import type { Page as PlaywrightPage } from 'playwright';

const log = getLogger('entry', { component: 'multi-step-strategy' });

export class MultiStepStrategy implements EntryStrategy {
  readonly name = 'multi-step';

  private readonly formAnalyzer = new FormAnalyzer();
  private readonly multiStepHandler = new MultiStepHandler();
  private readonly checkboxHandler = new CheckboxHandler();
  private readonly confirmationHandler = new ConfirmationHandler();

  /**
   * Execute the multi-step form entry strategy.
   */
  async execute(context: EntryContext): Promise<EntryResult> {
    const { page, contest, profile, options, entryId } = context;
    const startTime = Date.now();
    const errors: string[] = [];

    log.info(
      { entryId, contestId: contest.id, url: contest.url },
      'Executing multi-step strategy',
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

      // Step 2: Verify this is indeed a multi-step form
      const analysis = await this.formAnalyzer.analyzeForm(page);
      if (analysis.fields.length === 0) {
        throw new EntryError(
          'No form fields detected on the first step',
          'NO_FORM_FIELDS',
          contest.id,
          entryId,
        );
      }

      log.info(
        { fieldCount: analysis.fields.length, isMultiStep: analysis.isMultiStep },
        'Initial form analyzed',
      );

      // Step 3: Execute multi-step form handling
      log.debug('Starting multi-step form handling');
      await this.multiStepHandler.handleMultiStep(page, profile);

      // Step 4: Handle final step checkboxes
      log.debug('Handling final checkboxes');
      await this.checkboxHandler.handleCheckboxes(page, {
        checkNewsletterForBonus: options.checkNewsletterForBonus,
        shareDataWithPartners: options.shareDataWithPartners,
      });

      // Step 5: Handle CAPTCHA on final step if present
      const finalAnalysis = await this.formAnalyzer.analyzeForm(page);
      if (finalAnalysis.hasCaptcha) {
        log.info('CAPTCHA detected on final step');
        try {
          await this.handleCaptcha(page);
        } catch (captchaError) {
          const msg = captchaError instanceof Error ? captchaError.message : String(captchaError);
          errors.push(`CAPTCHA: ${msg}`);
          log.error({ error: msg }, 'CAPTCHA solving failed on final step, aborting submission');
          throw new EntryError(
            `CAPTCHA solving failed: ${msg}`,
            'CAPTCHA_FAILED',
            contest.id,
            entryId,
          );
        }
      }

      // Step 6: Submit the final form
      if (finalAnalysis.submitButton) {
        log.debug({ submitButton: finalAnalysis.submitButton }, 'Submitting final form');
        await page.click(finalAnalysis.submitButton);

        try {
          await page.waitForNavigation({ timeout: 15_000 });
        } catch {
          log.debug('No navigation after final submit');
        }
      }

      // Step 7: Handle confirmation
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
        { entryId, status, durationMs },
        'Multi-step strategy complete',
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startTime;
      errors.push(message);

      let screenshotPath: string | undefined;
      try {
        screenshotPath = `./data/screenshots/error_${entryId}_${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: false });
      } catch {
        // Screenshot failure should not mask the original error
        screenshotPath = undefined;
      }

      eventBus.emit('entry:failed', { entryId, error: message });

      log.error({ entryId, error: message, durationMs }, 'Multi-step strategy failed');

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
    const detection = await detectCaptcha(page as unknown as PlaywrightPage);

    if (!detection) {
      log.warn('CAPTCHA was expected but detector found none on the page');
      return;
    }

    log.info({ captchaType: detection.type, siteKey: detection.siteKey }, 'CAPTCHA detected, solving');
    eventBus.emit('captcha:solving', { type: detection.type, provider: 'pending' });

    const solver = new CaptchaSolver();
    await solver.solve(detection, page as unknown as PlaywrightPage);
  }
}
