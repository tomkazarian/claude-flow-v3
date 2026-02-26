import type { Page } from 'playwright';
import { getLogger } from '../../shared/logger.js';
import { CaptchaError } from '../../shared/errors.js';
import type { CaptchaDetection, CaptchaServiceProvider } from '../types.js';

const log = getLogger('captcha', { component: 'solver:recaptcha-v2' });

/**
 * Solves a reCAPTCHA v2 challenge on the given page:
 *   1. Extracts the siteKey from the detection or page
 *   2. Submits to the CAPTCHA solving provider
 *   3. Injects the response token into the page
 *   4. Triggers the callback to notify the reCAPTCHA widget
 *
 * Returns the token string on success.
 */
export async function solveRecaptchaV2OnPage(
  detection: CaptchaDetection,
  page: Page,
  provider: CaptchaServiceProvider,
): Promise<string> {
  const { siteKey, pageUrl, isInvisible } = detection;

  if (!siteKey) {
    throw new CaptchaError(
      'Cannot solve reCAPTCHA v2: siteKey not found',
      'CAPTCHA_MISSING_SITEKEY',
      'recaptcha-v2',
      provider.name,
    );
  }

  log.info(
    { siteKey, pageUrl, isInvisible, provider: provider.name },
    'Solving reCAPTCHA v2',
  );

  // Send to solving provider
  const token = await provider.solveRecaptchaV2(siteKey, pageUrl, isInvisible);

  if (!token) {
    throw new CaptchaError(
      'Provider returned empty token for reCAPTCHA v2',
      'CAPTCHA_EMPTY_TOKEN',
      'recaptcha-v2',
      provider.name,
    );
  }

  // Inject the token into the page
  await injectRecaptchaV2Token(page, token);

  // Verify that the token was injected correctly
  const verified = await verifyTokenInjection(page);
  if (!verified) {
    log.warn('Token injection verification failed, but proceeding');
  }

  log.info({ provider: provider.name }, 'reCAPTCHA v2 token injected successfully');
  return token;
}

/**
 * Injects the reCAPTCHA v2 response token into the page by:
 *   1. Setting the value of textarea#g-recaptcha-response
 *   2. Making the textarea visible (some sites check display)
 *   3. Calling the callback function registered with the widget
 */
async function injectRecaptchaV2Token(page: Page, token: string): Promise<void> {
  await page.evaluate((tkn: string) => {
    // Find all recaptcha response textareas (there may be multiple on a page)
    const textareas = document.querySelectorAll('textarea[name="g-recaptcha-response"]');

    if (textareas.length === 0) {
      // Try the ID-based selector as fallback
      const byId = document.getElementById('g-recaptcha-response');
      if (byId) {
        (byId as HTMLTextAreaElement).value = tkn;
        byId.style.display = 'block';
      }
    } else {
      for (const textarea of textareas) {
        const ta = textarea as HTMLTextAreaElement;
        ta.value = tkn;
        ta.style.display = 'block';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // Try to find and call the reCAPTCHA callback
    // Method 1: Check data-callback attribute on the recaptcha div
    const recaptchaDiv = document.querySelector('.g-recaptcha');
    if (recaptchaDiv) {
      const callbackName = recaptchaDiv.getAttribute('data-callback');
      if (callbackName && typeof (window as unknown as Record<string, unknown>)[callbackName] === 'function') {
        (window as unknown as Record<string, CallableFunction>)[callbackName]!(tkn);
        return;
      }
    }

    // Method 2: Try the global grecaptcha callback
    const grecaptcha = (window as unknown as Record<string, unknown>)['grecaptcha'] as
      | { getResponse?: () => string; execute?: () => void }
      | undefined;

    if (grecaptcha) {
      // Some implementations store callbacks internally
      // We try to trigger any registered callback by finding it in the page context
      const _findCallback = (): CallableFunction | undefined => {
        // Check common callback patterns
        const patterns = [
          'onRecaptchaSuccess',
          'recaptchaCallback',
          'captchaCallback',
          'onCaptchaVerify',
          'recaptchaVerified',
          'onSubmit',
        ];

        for (const name of patterns) {
          const fn = (window as unknown as Record<string, unknown>)[name];
          if (typeof fn === 'function') {
            return fn as CallableFunction;
          }
        }
        return undefined;
      };

      const cb = _findCallback();
      if (cb) {
        cb(tkn);
        return;
      }
    }

    // Method 3: Find callback from ___grecaptcha_cfg
    const cfg = (window as unknown as Record<string, unknown>)['___grecaptcha_cfg'] as
      | { clients?: Record<string, Record<string, unknown>> }
      | undefined;

    if (cfg?.clients) {
      for (const clientId of Object.keys(cfg.clients)) {
        const client = cfg.clients[clientId];
        if (!client) continue;

        // Walk through client properties to find the callback
        const findCallbackInObject = (obj: Record<string, unknown>, depth = 0): CallableFunction | undefined => {
          if (depth > 5) return undefined;
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (typeof val === 'function') {
              return val as CallableFunction;
            }
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              const found = findCallbackInObject(val as Record<string, unknown>, depth + 1);
              if (found) return found;
            }
          }
          return undefined;
        };

        const callback = findCallbackInObject(client);
        if (callback) {
          try {
            callback(tkn);
          } catch {
            // Callback failed, continue searching
          }
        }
      }
    }
  }, token);
}

/**
 * Verifies that the reCAPTCHA token was successfully injected
 * by checking the textarea value.
 */
async function verifyTokenInjection(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const textarea = document.querySelector(
      'textarea[name="g-recaptcha-response"]',
    ) as HTMLTextAreaElement | null;

    if (!textarea) {
      const byId = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement | null;
      return byId !== null && byId.value.length > 0;
    }

    return textarea.value.length > 0;
  });
}
