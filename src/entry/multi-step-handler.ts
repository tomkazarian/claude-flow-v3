/**
 * Multi-step form handler.
 *
 * Handles paginated forms, wizard-style flows, multi-page entry
 * processes, popup modals, and iframe-embedded forms.
 * Tracks progress to avoid infinite loops.
 */

import { getLogger } from '../shared/logger.js';
import { humanClickDelay, humanPageLoadWait, sleep } from '../shared/timing.js';
import { FormAnalyzer } from './form-analyzer.js';
import { FormFiller } from './form-filler.js';
import { CheckboxHandler } from './checkbox-handler.js';
import type { Page, Profile, StepInfo } from './types.js';

const log = getLogger('entry', { component: 'multi-step-handler' });

const MAX_STEPS = 10;
const MAX_REDIRECTS = 5;
const NAVIGATION_WAIT_MS = 5_000;

/** Selectors for next/continue buttons. */
const NEXT_BUTTON_SELECTORS = [
  'button:has-text("Next")', 'button:has-text("Continue")',
  'button:has-text("next")', 'button:has-text("continue")',
  'input[type="button"][value*="Next" i]',
  'input[type="button"][value*="Continue" i]',
  'a:has-text("Next")', 'a:has-text("Continue")',
  'button.next', 'button.continue', 'button.btn-next',
  '.next-step', '.next-button', '.continue-button',
  'button[class*="next"]', 'button[class*="continue"]',
  'input[type="submit"][value*="Next" i]',
  'input[type="submit"][value*="Continue" i]',
];

export class MultiStepHandler {
  private readonly formAnalyzer = new FormAnalyzer();
  private readonly formFiller = new FormFiller();
  private readonly checkboxHandler = new CheckboxHandler();

  /**
   * Handle a multi-step form by iterating through each step,
   * filling forms and clicking next until complete.
   */
  async handleMultiStep(page: Page, profile: Profile): Promise<void> {
    log.info('Starting multi-step form handling');

    let stepCount = 0;
    let redirectCount = 0;
    let previousUrl = page.url();

    while (stepCount < MAX_STEPS) {
      stepCount++;
      log.info({ step: stepCount }, 'Processing step');

      // Handle any iframes that contain forms
      await this.handleIframeForm(page);

      // Detect current step info
      const stepInfo = await this.detectStepInfo(page);
      log.debug(
        {
          currentStep: stepInfo.currentStep,
          totalSteps: stepInfo.totalSteps,
          hasNext: stepInfo.hasNext,
        },
        'Step info detected',
      );

      // Analyze and fill the current step's form
      const analysis = await this.formAnalyzer.analyzeForm(page);

      if (analysis.fields.length > 0) {
        await this.formFiller.fillForm(page, analysis, profile);
        await this.checkboxHandler.handleCheckboxes(page);
      }

      // Check if there is a next step
      if (!stepInfo.hasNext) {
        log.info({ step: stepCount }, 'No more steps detected, multi-step complete');
        break;
      }

      // Click the next/continue button
      const nextSelector = stepInfo.nextButtonSelector ?? await this.findNextButton(page);
      if (!nextSelector) {
        log.info({ step: stepCount }, 'No next button found, assuming last step');
        break;
      }

      await this.clickNextButton(page, nextSelector);

      // Wait for navigation or page update
      const navigated = await this.waitForStepTransition(page, previousUrl);

      if (navigated) {
        const currentUrl = page.url();
        if (currentUrl !== previousUrl) {
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            log.warn({ redirectCount }, 'Too many redirects, stopping');
            break;
          }
          previousUrl = currentUrl;
        }
      }

      // Handle popup/modal forms
      await this.handlePopupForm(page);
    }

    if (stepCount >= MAX_STEPS) {
      log.warn({ stepCount }, 'Reached maximum step count, stopping');
    }

    log.info({ totalSteps: stepCount }, 'Multi-step handling complete');
  }

  /**
   * Detect information about the current step.
   */
  private async detectStepInfo(page: Page): Promise<StepInfo> {
    try {
      const info = await page.evaluate(() => {
        const body = document.body.textContent ?? '';

        // Try to find "Step X of Y" text
        const stepMatch = body.match(/step\s+(\d+)\s+(?:of|\/)\s+(\d+)/i);
        let currentStep = 1;
        let totalSteps: number | null = null;

        if (stepMatch) {
          currentStep = parseInt(stepMatch[1]!, 10);
          totalSteps = parseInt(stepMatch[2]!, 10);
        }

        // Check for next/continue buttons
        const nextSelectors = [
          'button', 'input[type="button"]', 'input[type="submit"]', 'a.btn',
        ];
        const nextTexts = ['next', 'continue', 'proceed', 'next step'];
        let hasNext = false;
        let nextButtonSelector: string | null = null;

        for (const sel of nextSelectors) {
          const elements = document.querySelectorAll(sel);
          for (const el of elements) {
            const text = el.textContent?.toLowerCase().trim() ?? '';
            const value = (el as HTMLInputElement).value?.toLowerCase() ?? '';
            const combined = `${text} ${value}`;

            for (const nextText of nextTexts) {
              if (combined.includes(nextText)) {
                hasNext = true;
                if (el.id) {
                  nextButtonSelector = `#${CSS.escape(el.id)}`;
                } else {
                  nextButtonSelector = null;
                }
                break;
              }
            }
            if (hasNext) break;
          }
          if (hasNext) break;
        }

        return { currentStep, totalSteps, hasNext, nextButtonSelector };
      }) as StepInfo;

      return info;
    } catch {
      return {
        currentStep: 1,
        totalSteps: null,
        hasNext: false,
        nextButtonSelector: null,
      };
    }
  }

  /**
   * Find the next/continue button.
   */
  private async findNextButton(page: Page): Promise<string | null> {
    for (const selector of NEXT_BUTTON_SELECTORS) {
      try {
        const visible = await page.isVisible(selector);
        if (visible) {
          return selector;
        }
      } catch {
        // Selector not found
      }
    }

    // Try finding by text content
    try {
      const selector = await page.evaluate(() => {
        const nextTexts = ['next', 'continue', 'proceed', 'next step', 'go to step'];
        const elements = document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a.button');

        for (const el of elements) {
          const text = el.textContent?.toLowerCase().trim() ?? '';
          const value = (el as HTMLInputElement).value?.toLowerCase() ?? '';

          for (const nextText of nextTexts) {
            if (text.includes(nextText) || value.includes(nextText)) {
              if (el.id) return `#${CSS.escape(el.id)}`;
              return null;
            }
          }
        }
        return null;
      }) as string | null;

      return selector;
    } catch {
      return null;
    }
  }

  /**
   * Click the next/continue button with human-like behavior.
   */
  private async clickNextButton(page: Page, selector: string): Promise<void> {
    log.debug({ selector }, 'Clicking next button');

    await humanClickDelay();

    try {
      await page.click(selector);
    } catch {
      // If the specific selector fails, try a broader approach
      log.debug({ selector }, 'Primary click failed, trying fallback');
      try {
        await page.evaluate(
          (sel: unknown) => {
            const el = document.querySelector(sel as string);
            if (el) (el as HTMLElement).click();
          },
          selector,
        );
      } catch (error) {
        log.error(
          { selector, error: error instanceof Error ? error.message : String(error) },
          'Failed to click next button',
        );
        throw error;
      }
    }
  }

  /**
   * Wait for the page to transition to the next step.
   * Returns true if a navigation occurred.
   */
  private async waitForStepTransition(page: Page, previousUrl: string): Promise<boolean> {
    try {
      // Wait for either navigation or DOM change
      await Promise.race([
        page.waitForNavigation({ timeout: NAVIGATION_WAIT_MS }).catch(() => null),
        sleep(NAVIGATION_WAIT_MS),
      ]);

      // Additional wait for dynamic content loading
      await humanPageLoadWait();

      const currentUrl = page.url();
      return currentUrl !== previousUrl;
    } catch {
      // Timeout is acceptable; page may update without navigation
      await sleep(2000);
      return false;
    }
  }

  /**
   * Detect and switch to an iframe that contains a form.
   * Returns true if we switched to an iframe.
   */
  private async handleIframeForm(page: Page): Promise<boolean> {
    try {
      const hasFormIframe = await page.evaluate(() => {
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument;
            if (doc && doc.querySelector('form')) {
              return true;
            }
          } catch {
            // Cross-origin iframe; cannot inspect
          }
        }
        return false;
      }) as boolean;

      if (hasFormIframe) {
        log.info('Form-containing iframe detected');
        // Note: actual iframe switching depends on the Playwright API.
        // The caller will need to handle frame navigation.
      }

      return hasFormIframe;
    } catch {
      return false;
    }
  }

  /**
   * Handle popup/modal forms that may appear during the entry process.
   */
  private async handlePopupForm(page: Page): Promise<void> {
    try {
      const hasModal = await page.evaluate(() => {
        const modalSelectors = [
          '.modal.show', '.modal.active', '.modal.visible',
          '[class*="modal"][class*="open"]',
          '.popup.show', '.popup.active', '.popup.visible',
          '[class*="popup"][class*="open"]',
          '.overlay.show', '.overlay.active',
          '[role="dialog"][aria-modal="true"]',
        ];

        for (const sel of modalSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden') {
              return true;
            }
          }
        }
        return false;
      }) as boolean;

      if (hasModal) {
        log.info('Modal/popup detected, will be handled in next iteration');
      }
    } catch {
      // Best-effort modal detection
    }
  }
}
