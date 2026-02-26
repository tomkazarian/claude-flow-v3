/**
 * Instant win game entry strategy.
 *
 * Handles instant win contests: navigate to the page, play the game,
 * detect the result, and record the outcome.
 */

import { getLogger } from '../../shared/logger.js';
import { eventBus } from '../../shared/events.js';
import { ENTRY_STATUSES, DEFAULT_LIMITS } from '../../shared/constants.js';
import { humanPageLoadWait } from '../../shared/timing.js';
import { FormAnalyzer } from '../form-analyzer.js';
import { FormFiller } from '../form-filler.js';
import { CheckboxHandler } from '../checkbox-handler.js';
import { InstantWinHandler } from '../instant-win-handler.js';
import { ConfirmationHandler } from '../confirmation-handler.js';
import type { EntryStrategy, EntryContext, EntryResult, Page } from '../types.js';

const log = getLogger('entry', { component: 'instant-win-strategy' });

export class InstantWinStrategy implements EntryStrategy {
  readonly name = 'instant-win';

  private readonly formAnalyzer = new FormAnalyzer();
  private readonly formFiller = new FormFiller();
  private readonly checkboxHandler = new CheckboxHandler();
  private readonly instantWinHandler = new InstantWinHandler();
  private readonly confirmationHandler = new ConfirmationHandler();

  /**
   * Execute the instant win entry strategy.
   */
  async execute(context: EntryContext): Promise<EntryResult> {
    const { page, contest, profile, options, entryId } = context;
    const startTime = Date.now();
    const errors: string[] = [];

    log.info(
      { entryId, contestId: contest.id, url: contest.url },
      'Executing instant win strategy',
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

      // Step 2: Check if there is a pre-game form to fill
      const analysis = await this.formAnalyzer.analyzeForm(page);

      if (analysis.fields.length > 0) {
        log.info(
          { fieldCount: analysis.fields.length },
          'Pre-game form detected, filling fields',
        );

        await this.formFiller.fillForm(page, analysis, profile);
        await this.checkboxHandler.handleCheckboxes(page, {
          checkNewsletterForBonus: options.checkNewsletterForBonus,
          shareDataWithPartners: options.shareDataWithPartners,
        });

        // Handle CAPTCHA if present
        if (analysis.hasCaptcha) {
          log.info('CAPTCHA detected before game');
          try {
            await this.handleCaptcha(page);
          } catch (captchaError) {
            const msg = captchaError instanceof Error ? captchaError.message : String(captchaError);
            errors.push(`CAPTCHA: ${msg}`);
          }
        }

        // Submit pre-game form if there is a submit button
        if (analysis.submitButton) {
          log.debug('Submitting pre-game form');
          await page.click(analysis.submitButton);

          try {
            await page.waitForNavigation({ timeout: 10_000 });
          } catch {
            // May be AJAX
          }
          await humanPageLoadWait();
        }
      }

      // Step 3: Play the instant win game
      log.info('Playing instant win game');
      const instantWinResult = await this.instantWinHandler.play(page);

      log.info(
        {
          played: instantWinResult.played,
          won: instantWinResult.won,
          prize: instantWinResult.prize,
        },
        'Instant win game result',
      );

      // Step 4: If won, emit win event
      if (instantWinResult.won) {
        eventBus.emit('win:detected', {
          entryId,
          prizeValue: 0,
          prizeDescription: instantWinResult.prize ?? 'Unknown prize',
        });
      }

      // Step 5: Handle confirmation/result page
      const confirmation = await this.confirmationHandler.handleConfirmation(page, entryId);

      const durationMs = Date.now() - startTime;
      const status = instantWinResult.played
        ? ENTRY_STATUSES.CONFIRMED
        : ENTRY_STATUSES.FAILED;

      const result: EntryResult = {
        entryId,
        contestId: contest.id,
        profileId: profile.id,
        status,
        message: instantWinResult.won
          ? `Won: ${instantWinResult.prize ?? 'Prize'}`
          : instantWinResult.played
            ? 'Game played, did not win'
            : 'Could not play game',
        confirmationNumber: confirmation.confirmationNumber,
        screenshotPath: confirmation.screenshotPath,
        timestamp: new Date().toISOString(),
        durationMs,
        instantWinResult,
        errors,
      };

      if (status === ENTRY_STATUSES.CONFIRMED) {
        eventBus.emit('entry:confirmed', { entryId });
      } else {
        eventBus.emit('entry:failed', { entryId, error: result.message });
      }

      log.info(
        { entryId, status, won: instantWinResult.won, durationMs },
        'Instant win strategy complete',
      );

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startTime;
      errors.push(message);

      let screenshotPath: string | undefined;
      try {
        await page.screenshot({ fullPage: false });
        screenshotPath = `./data/screenshots/error_${entryId}_${Date.now()}.png`;
      } catch {
        // Ignore
      }

      eventBus.emit('entry:failed', { entryId, error: message });

      log.error({ entryId, error: message, durationMs }, 'Instant win strategy failed');

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
   */
  private async handleCaptcha(_page: Page): Promise<void> {
    eventBus.emit('captcha:solving', { type: 'unknown', provider: 'pending' });
    log.warn('CAPTCHA solving delegated to captcha module');
  }
}
