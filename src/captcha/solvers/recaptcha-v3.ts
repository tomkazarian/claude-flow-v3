import type { Page } from 'playwright';
import { getLogger } from '../../shared/logger.js';
import { CaptchaError } from '../../shared/errors.js';
import type { CaptchaDetection, CaptchaServiceProvider } from '../types.js';

const log = getLogger('captcha', { component: 'solver:recaptcha-v3' });

/**
 * Solves a reCAPTCHA v3 challenge on the given page:
 *   1. Extracts siteKey and action from the detection
 *   2. Submits to the CAPTCHA solving provider
 *   3. Overrides grecaptcha.execute to return the solved token
 *   4. Injects the token into any hidden response fields
 *
 * Returns the token string on success.
 */
export async function solveRecaptchaV3OnPage(
  detection: CaptchaDetection,
  page: Page,
  provider: CaptchaServiceProvider,
): Promise<string> {
  const { siteKey, pageUrl, action } = detection;

  if (!siteKey) {
    throw new CaptchaError(
      'Cannot solve reCAPTCHA v3: siteKey not found',
      'CAPTCHA_MISSING_SITEKEY',
      'recaptcha-v3',
      provider.name,
    );
  }

  log.info(
    { siteKey, pageUrl, action, provider: provider.name },
    'Solving reCAPTCHA v3',
  );

  // Get the action from detection or use a default
  const resolvedAction = action ?? 'verify';

  // Send to solving provider
  const token = await provider.solveRecaptchaV3(siteKey, pageUrl, resolvedAction);

  if (!token) {
    throw new CaptchaError(
      'Provider returned empty token for reCAPTCHA v3',
      'CAPTCHA_EMPTY_TOKEN',
      'recaptcha-v3',
      provider.name,
    );
  }

  // Inject the token into the page
  await injectRecaptchaV3Token(page, token);

  log.info({ provider: provider.name, action: resolvedAction }, 'reCAPTCHA v3 token injected successfully');
  return token;
}

/**
 * Injects the reCAPTCHA v3 token by:
 *   1. Overriding grecaptcha.execute to return a resolved Promise with the token
 *   2. Setting any hidden g-recaptcha-response textareas
 *   3. Setting any hidden input fields named g-recaptcha-response
 */
async function injectRecaptchaV3Token(page: Page, token: string): Promise<void> {
  await page.evaluate((tkn: string) => {
    // Override grecaptcha.execute to always return the solved token
    const grecaptcha = (window as unknown as Record<string, unknown>)['grecaptcha'] as
      | Record<string, unknown>
      | undefined;

    if (grecaptcha) {
      // Override execute method
      grecaptcha['execute'] = () => Promise.resolve(tkn);

      // Also override the enterprise version if present
      const enterprise = grecaptcha['enterprise'] as Record<string, unknown> | undefined;
      if (enterprise) {
        enterprise['execute'] = () => Promise.resolve(tkn);
      }

      // Override ready callback to fire immediately
      grecaptcha['ready'] = (cb: CallableFunction) => {
        if (typeof cb === 'function') cb();
      };
    } else {
      // grecaptcha not loaded yet; create a mock
      (window as unknown as Record<string, unknown>)['grecaptcha'] = {
        execute: () => Promise.resolve(tkn),
        ready: (cb: CallableFunction) => {
          if (typeof cb === 'function') cb();
        },
        render: () => 0,
        reset: () => undefined,
        getResponse: () => tkn,
        enterprise: {
          execute: () => Promise.resolve(tkn),
          ready: (cb: CallableFunction) => {
            if (typeof cb === 'function') cb();
          },
          render: () => 0,
          reset: () => undefined,
          getResponse: () => tkn,
        },
      };
    }

    // Set hidden textarea values
    const textareas = document.querySelectorAll('textarea[name="g-recaptcha-response"]');
    for (const textarea of textareas) {
      (textarea as HTMLTextAreaElement).value = tkn;
    }

    // Set hidden input values
    const inputs = document.querySelectorAll('input[name="g-recaptcha-response"]');
    for (const input of inputs) {
      (input as HTMLInputElement).value = tkn;
    }

    // Some forms store the token in a custom data attribute or variable
    // Try to find and set common token storage locations
    const tokenFields = document.querySelectorAll(
      'input[name="recaptcha_token"], input[name="recaptcha-token"], input[name="captcha_token"]',
    );
    for (const field of tokenFields) {
      (field as HTMLInputElement).value = tkn;
    }
  }, token);
}
