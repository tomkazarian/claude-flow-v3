import type { Page } from 'playwright';
import { getLogger } from '../../shared/logger.js';
import { CaptchaError } from '../../shared/errors.js';
import type { CaptchaDetection, CaptchaServiceProvider } from '../types.js';

const log = getLogger('captcha', { component: 'solver:hcaptcha' });

/**
 * Solves an hCaptcha challenge on the given page:
 *   1. Extracts the siteKey from the detection
 *   2. Submits to the CAPTCHA solving provider
 *   3. Injects the response token into the page's hidden fields
 *   4. Triggers the hCaptcha callback to submit the form
 *
 * Returns the token string on success.
 */
export async function solveHCaptchaOnPage(
  detection: CaptchaDetection,
  page: Page,
  provider: CaptchaServiceProvider,
): Promise<string> {
  const { siteKey, pageUrl } = detection;

  if (!siteKey) {
    throw new CaptchaError(
      'Cannot solve hCaptcha: siteKey not found',
      'CAPTCHA_MISSING_SITEKEY',
      'hcaptcha',
      provider.name,
    );
  }

  log.info(
    { siteKey, pageUrl, provider: provider.name },
    'Solving hCaptcha',
  );

  // Send to solving provider
  const token = await provider.solveHCaptcha(siteKey, pageUrl);

  if (!token) {
    throw new CaptchaError(
      'Provider returned empty token for hCaptcha',
      'CAPTCHA_EMPTY_TOKEN',
      'hcaptcha',
      provider.name,
    );
  }

  // Inject the token into the page
  await injectHCaptchaToken(page, token);

  // Verify injection
  const verified = await verifyHCaptchaInjection(page);
  if (!verified) {
    log.warn('hCaptcha token injection verification failed, but proceeding');
  }

  log.info({ provider: provider.name }, 'hCaptcha token injected successfully');
  return token;
}

/**
 * Injects the hCaptcha response token into the page by:
 *   1. Setting the hidden textarea[name="h-captcha-response"]
 *   2. Setting textarea[name="g-recaptcha-response"] (hCaptcha compatibility)
 *   3. Calling the data-callback function if registered
 */
async function injectHCaptchaToken(page: Page, token: string): Promise<void> {
  await page.evaluate((tkn: string) => {
    // Set h-captcha-response textarea
    const hcaptchaTextareas = document.querySelectorAll(
      'textarea[name="h-captcha-response"]',
    );
    for (const textarea of hcaptchaTextareas) {
      const ta = textarea as HTMLTextAreaElement;
      ta.value = tkn;
      ta.style.display = 'block';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // hCaptcha also populates g-recaptcha-response for backwards compatibility
    const gRecaptchaTextareas = document.querySelectorAll(
      'textarea[name="g-recaptcha-response"]',
    );
    for (const textarea of gRecaptchaTextareas) {
      (textarea as HTMLTextAreaElement).value = tkn;
    }

    // Find and call the callback from the .h-captcha container
    const hcaptchaDiv = document.querySelector('.h-captcha');
    if (hcaptchaDiv) {
      const callbackName = hcaptchaDiv.getAttribute('data-callback');
      if (callbackName && typeof (window as unknown as Record<string, unknown>)[callbackName] === 'function') {
        (window as unknown as Record<string, CallableFunction>)[callbackName]!(tkn);
        return;
      }
    }

    // Try common callback names
    const callbackNames = [
      'onHCaptchaSuccess',
      'hcaptchaCallback',
      'captchaCallback',
      'onCaptchaVerify',
      'onCaptchaSuccess',
    ];

    for (const name of callbackNames) {
      const fn = (window as unknown as Record<string, unknown>)[name];
      if (typeof fn === 'function') {
        (fn as CallableFunction)(tkn);
        return;
      }
    }

    // Try to trigger hcaptcha global object's callback
    const hcaptcha = (window as unknown as Record<string, unknown>)['hcaptcha'] as
      | Record<string, unknown>
      | undefined;

    if (hcaptcha) {
      // Override getResponse to return our token
      hcaptcha['getResponse'] = () => tkn;

      // Some implementations store the callback in hcaptcha.getRespKey()
      // Try to trigger internal validation
      if (typeof hcaptcha['execute'] === 'function') {
        try {
          // Don't actually call execute as it would start a new challenge
          // Just override the stored response
        } catch {
          // Ignore errors
        }
      }
    }
  }, token);
}

/**
 * Verifies that the hCaptcha token was successfully injected.
 */
async function verifyHCaptchaInjection(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const textarea = document.querySelector(
      'textarea[name="h-captcha-response"]',
    ) as HTMLTextAreaElement | null;

    return textarea !== null && textarea.value.length > 0;
  });
}
