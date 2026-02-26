import type { Page } from 'playwright';
import { getLogger } from '../../shared/logger.js';
import { CaptchaError } from '../../shared/errors.js';
import type { CaptchaDetection, CaptchaServiceProvider } from '../types.js';

const log = getLogger('captcha', { component: 'solver:turnstile' });

/**
 * Solves a Cloudflare Turnstile challenge on the given page:
 *   1. Extracts the siteKey from the detection
 *   2. Submits to the CAPTCHA solving provider
 *   3. Injects the token and triggers the turnstile callback
 *
 * Returns the token string on success.
 */
export async function solveTurnstileOnPage(
  detection: CaptchaDetection,
  page: Page,
  provider: CaptchaServiceProvider,
): Promise<string> {
  const { siteKey, pageUrl } = detection;

  if (!siteKey) {
    // Try to extract siteKey from the page if not in detection
    const extractedKey = await extractTurnstileSiteKey(page);
    if (!extractedKey) {
      throw new CaptchaError(
        'Cannot solve Turnstile: siteKey not found',
        'CAPTCHA_MISSING_SITEKEY',
        'turnstile',
        provider.name,
      );
    }
    detection = { ...detection, siteKey: extractedKey };
  }

  log.info(
    { siteKey: detection.siteKey, pageUrl, provider: provider.name },
    'Solving Cloudflare Turnstile',
  );

  // Send to solving provider
  const token = await provider.solveTurnstile(detection.siteKey, pageUrl);

  if (!token) {
    throw new CaptchaError(
      'Provider returned empty token for Turnstile',
      'CAPTCHA_EMPTY_TOKEN',
      'turnstile',
      provider.name,
    );
  }

  // Inject the token into the page
  await injectTurnstileToken(page, token);

  // Verify injection
  const verified = await verifyTurnstileInjection(page);
  if (!verified) {
    log.warn('Turnstile token injection verification failed, but proceeding');
  }

  log.info({ provider: provider.name }, 'Turnstile token injected successfully');
  return token;
}

/**
 * Extracts the Turnstile siteKey from the page when it was not
 * available during initial detection.
 */
async function extractTurnstileSiteKey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // Check cf-turnstile div
    const div = document.querySelector('.cf-turnstile');
    if (div) {
      const key = div.getAttribute('data-sitekey');
      if (key) return key;
    }

    // Check for turnstile render calls in scripts
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent ?? '';
      const match = text.match(/turnstile\.render\s*\([^,]*,\s*\{\s*sitekey\s*:\s*['"]([^'"]+)['"]/);
      if (match?.[1]) return match[1];
    }

    // Check any elements with data-sitekey near turnstile-related classes
    const siteKeyElements = document.querySelectorAll('[data-sitekey]');
    for (const el of siteKeyElements) {
      const parent = el.closest('.cf-turnstile') ?? el.closest('[class*="turnstile"]');
      if (parent) {
        return el.getAttribute('data-sitekey');
      }
    }

    return null;
  });
}

/**
 * Injects the Turnstile token into the page by:
 *   1. Setting hidden input[name="cf-turnstile-response"]
 *   2. Setting any data attributes on the turnstile container
 *   3. Calling the turnstile callback if registered
 *   4. Overriding the turnstile global to return our token
 */
async function injectTurnstileToken(page: Page, token: string): Promise<void> {
  await page.evaluate((tkn: string) => {
    // Set the hidden input field
    const inputs = document.querySelectorAll(
      'input[name="cf-turnstile-response"], input[name="turnstile-response"]',
    );
    for (const input of inputs) {
      (input as HTMLInputElement).value = tkn;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // If no specific input found, try generic captcha response inputs
    if (inputs.length === 0) {
      const genericInputs = document.querySelectorAll(
        'input[name*="turnstile"], textarea[name*="turnstile"]',
      );
      for (const input of genericInputs) {
        (input as HTMLInputElement).value = tkn;
      }
    }

    // Find the cf-turnstile container and trigger its callback
    const turnstileDiv = document.querySelector('.cf-turnstile');
    if (turnstileDiv) {
      const callbackName = turnstileDiv.getAttribute('data-callback');
      if (callbackName && typeof (window as unknown as Record<string, unknown>)[callbackName] === 'function') {
        (window as unknown as Record<string, CallableFunction>)[callbackName]!(tkn);
      }
    }

    // Override the turnstile global object
    const turnstile = (window as unknown as Record<string, unknown>)['turnstile'] as
      | Record<string, unknown>
      | undefined;

    if (turnstile) {
      turnstile['getResponse'] = () => tkn;
    } else {
      (window as unknown as Record<string, unknown>)['turnstile'] = {
        getResponse: () => tkn,
        render: () => '0',
        reset: () => undefined,
        remove: () => undefined,
        isExpired: () => false,
        execute: () => undefined,
      };
    }

    // Try common callback patterns for Turnstile
    const callbackNames = [
      'onTurnstileSuccess',
      'turnstileCallback',
      'cfCallback',
      'onCFVerify',
    ];

    for (const name of callbackNames) {
      const fn = (window as unknown as Record<string, unknown>)[name];
      if (typeof fn === 'function') {
        (fn as CallableFunction)(tkn);
        break;
      }
    }
  }, token);
}

/**
 * Verifies that the Turnstile token was successfully injected.
 */
async function verifyTurnstileInjection(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // Check the hidden input
    const input = document.querySelector(
      'input[name="cf-turnstile-response"]',
    ) as HTMLInputElement | null;

    if (input && input.value.length > 0) return true;

    // Check the turnstile global
    const turnstile = (window as unknown as Record<string, unknown>)['turnstile'] as
      | { getResponse?: () => string }
      | undefined;

    if (turnstile && typeof turnstile.getResponse === 'function') {
      const resp = turnstile.getResponse();
      return resp !== undefined && resp.length > 0;
    }

    return false;
  });
}
