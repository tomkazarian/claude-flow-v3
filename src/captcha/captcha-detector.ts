import type { Page } from 'playwright';
import { getLogger } from '../shared/logger.js';
import type { CaptchaDetection } from './types.js';

const log = getLogger('captcha', { component: 'detector' });

/**
 * Detects the presence and type of CAPTCHA on a Playwright page.
 * Checks for reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile,
 * FunCaptcha/Arkose Labs, and simple image CAPTCHAs.
 *
 * Returns null if no CAPTCHA is detected.
 */
export async function detectCaptcha(page: Page): Promise<CaptchaDetection | null> {
  const pageUrl = page.url();

  log.debug({ url: pageUrl }, 'Scanning page for CAPTCHAs');

  // Run all detection checks in parallel for speed
  const [recaptchaV2, recaptchaV3, hcaptcha, turnstile, funcaptcha, imageCaptcha] =
    await Promise.all([
      detectRecaptchaV2(page, pageUrl),
      detectRecaptchaV3(page, pageUrl),
      detectHCaptcha(page, pageUrl),
      detectTurnstile(page, pageUrl),
      detectFunCaptcha(page, pageUrl),
      detectImageCaptcha(page, pageUrl),
    ]);

  // Return the first detected CAPTCHA (priority order)
  const detected = recaptchaV2 ?? recaptchaV3 ?? hcaptcha ?? turnstile ?? funcaptcha ?? imageCaptcha;

  if (detected) {
    log.info(
      { type: detected.type, siteKey: detected.siteKey, isInvisible: detected.isInvisible },
      'CAPTCHA detected on page',
    );
  } else {
    log.debug({ url: pageUrl }, 'No CAPTCHA detected');
  }

  return detected;
}

/**
 * Detects reCAPTCHA v2 by looking for the .g-recaptcha element or
 * Google reCAPTCHA iframes.
 */
async function detectRecaptchaV2(page: Page, pageUrl: string): Promise<CaptchaDetection | null> {
  return page.evaluate((pUrl: string) => {
    // Check for .g-recaptcha div with data-sitekey
    const recaptchaDiv = document.querySelector('.g-recaptcha');
    if (recaptchaDiv) {
      const siteKey = recaptchaDiv.getAttribute('data-sitekey') ?? '';
      const size = recaptchaDiv.getAttribute('data-size');
      const isInvisible = size === 'invisible';

      if (siteKey) {
        return {
          type: 'recaptcha-v2' as const,
          siteKey,
          pageUrl: pUrl,
          isInvisible,
          selector: '.g-recaptcha',
        };
      }
    }

    // Check for reCAPTCHA iframes
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.src ?? '';
      if (src.includes('google.com/recaptcha') && src.includes('api2')) {
        // Extract sitekey from iframe src
        const urlObj = new URL(src);
        const siteKey = urlObj.searchParams.get('k') ?? '';
        if (siteKey) {
          return {
            type: 'recaptcha-v2' as const,
            siteKey,
            pageUrl: pUrl,
            isInvisible: false,
            selector: `iframe[src*="google.com/recaptcha"]`,
          };
        }
      }
    }

    return null;
  }, pageUrl);
}

/**
 * Detects reCAPTCHA v3 by looking for the reCAPTCHA v3 script tag
 * or calls to grecaptcha.execute.
 */
async function detectRecaptchaV3(page: Page, pageUrl: string): Promise<CaptchaDetection | null> {
  return page.evaluate((pUrl: string) => {
    // Check for reCAPTCHA v3 script
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const src = script.src ?? '';
      if (src.includes('recaptcha/api.js') || src.includes('recaptcha/enterprise.js')) {
        const urlObj = new URL(src);
        const render = urlObj.searchParams.get('render');
        if (render && render !== 'explicit') {
          return {
            type: 'recaptcha-v3' as const,
            siteKey: render,
            pageUrl: pUrl,
            isInvisible: true,
            selector: `script[src*="recaptcha"]`,
          };
        }
      }
    }

    // Check for v3 sitekey in inline scripts
    for (const script of scripts) {
      const text = script.textContent ?? '';
      // Look for grecaptcha.execute('sitekey', ...) calls
      const executeMatch = text.match(/grecaptcha\.execute\s*\(\s*['"]([^'"]+)['"]/);
      if (executeMatch?.[1]) {
        // Try to extract action
        const actionMatch = text.match(/action\s*:\s*['"]([^'"]+)['"]/);
        const result: {
          type: 'recaptcha-v3';
          siteKey: string;
          pageUrl: string;
          isInvisible: boolean;
          selector: string;
          action?: string;
        } = {
          type: 'recaptcha-v3',
          siteKey: executeMatch[1],
          pageUrl: pUrl,
          isInvisible: true,
          selector: 'script',
          action: actionMatch?.[1],
        };
        return result;
      }
    }

    return null;
  }, pageUrl);
}

/**
 * Detects hCaptcha by looking for the .h-captcha element or
 * hCaptcha scripts/iframes.
 */
async function detectHCaptcha(page: Page, pageUrl: string): Promise<CaptchaDetection | null> {
  return page.evaluate((pUrl: string) => {
    // Check for .h-captcha div
    const hcaptchaDiv = document.querySelector('.h-captcha');
    if (hcaptchaDiv) {
      const siteKey = hcaptchaDiv.getAttribute('data-sitekey') ?? '';
      const size = hcaptchaDiv.getAttribute('data-size');
      const isInvisible = size === 'invisible';

      if (siteKey) {
        return {
          type: 'hcaptcha' as const,
          siteKey,
          pageUrl: pUrl,
          isInvisible,
          selector: '.h-captcha',
        };
      }
    }

    // Check for hCaptcha iframes
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.src ?? '';
      if (src.includes('hcaptcha.com')) {
        const urlObj = new URL(src);
        const siteKey = urlObj.searchParams.get('sitekey') ?? '';
        if (siteKey) {
          return {
            type: 'hcaptcha' as const,
            siteKey,
            pageUrl: pUrl,
            isInvisible: false,
            selector: `iframe[src*="hcaptcha.com"]`,
          };
        }
      }
    }

    // Check for hCaptcha script tags
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      if ((script.src ?? '').includes('hcaptcha.com/1/api.js')) {
        const text = document.body.innerHTML;
        const keyMatch = text.match(/data-sitekey=["']([^"']+)["']/);
        if (keyMatch?.[1]) {
          return {
            type: 'hcaptcha' as const,
            siteKey: keyMatch[1],
            pageUrl: pUrl,
            isInvisible: false,
            selector: '[data-sitekey]',
          };
        }
      }
    }

    return null;
  }, pageUrl);
}

/**
 * Detects Cloudflare Turnstile by looking for cf-turnstile class
 * or challenges.cloudflare.com scripts.
 */
async function detectTurnstile(page: Page, pageUrl: string): Promise<CaptchaDetection | null> {
  return page.evaluate((pUrl: string) => {
    // Check for .cf-turnstile div
    const turnstileDiv = document.querySelector('.cf-turnstile');
    if (turnstileDiv) {
      const siteKey = turnstileDiv.getAttribute('data-sitekey') ?? '';
      if (siteKey) {
        return {
          type: 'turnstile' as const,
          siteKey,
          pageUrl: pUrl,
          isInvisible: false,
          selector: '.cf-turnstile',
        };
      }
    }

    // Check for turnstile script
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const src = script.src ?? '';
      if (src.includes('challenges.cloudflare.com/turnstile')) {
        // Look for sitekey in page HTML
        const html = document.body.innerHTML;
        const keyMatch = html.match(/data-sitekey=["']([^"']+)["']/);
        if (keyMatch?.[1]) {
          return {
            type: 'turnstile' as const,
            siteKey: keyMatch[1],
            pageUrl: pUrl,
            isInvisible: false,
            selector: '[data-sitekey]',
          };
        }
      }
    }

    // Check for turnstile iframes
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.src ?? '';
      if (src.includes('challenges.cloudflare.com')) {
        return {
          type: 'turnstile' as const,
          siteKey: '',
          pageUrl: pUrl,
          isInvisible: false,
          selector: `iframe[src*="challenges.cloudflare.com"]`,
        };
      }
    }

    return null;
  }, pageUrl);
}

/**
 * Detects FunCaptcha/Arkose Labs by looking for arkoselabs.com
 * scripts and funcaptcha elements.
 */
async function detectFunCaptcha(page: Page, pageUrl: string): Promise<CaptchaDetection | null> {
  return page.evaluate((pUrl: string) => {
    // Check scripts
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const src = script.src ?? '';
      if (src.includes('arkoselabs.com') || src.includes('funcaptcha.com')) {
        // Extract public key from script URL or page content
        const html = document.body.innerHTML;
        const keyMatch = html.match(/data-pkey=["']([^"']+)["']/) ??
          html.match(/publicKey\s*[=:]\s*["']([^"']+)["']/);

        return {
          type: 'funcaptcha' as const,
          siteKey: keyMatch?.[1] ?? '',
          pageUrl: pUrl,
          isInvisible: false,
          selector: '[data-pkey]',
        };
      }
    }

    // Check for funcaptcha container
    const funcaptchaDiv = document.querySelector('#funcaptcha') ??
      document.querySelector('[data-pkey]');
    if (funcaptchaDiv) {
      const siteKey = funcaptchaDiv.getAttribute('data-pkey') ?? '';
      return {
        type: 'funcaptcha' as const,
        siteKey,
        pageUrl: pUrl,
        isInvisible: false,
        selector: funcaptchaDiv.id ? `#${funcaptchaDiv.id}` : '[data-pkey]',
      };
    }

    return null;
  }, pageUrl);
}

/**
 * Detects simple image CAPTCHAs by looking for img elements near
 * text inputs with "captcha" in their name, id, or associated label.
 */
async function detectImageCaptcha(page: Page, pageUrl: string): Promise<CaptchaDetection | null> {
  return page.evaluate((pUrl: string) => {
    // Find inputs that look like captcha inputs
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');

    for (const input of inputs) {
      const inputEl = input as HTMLInputElement;
      const name = (inputEl.name ?? '').toLowerCase();
      const id = (inputEl.id ?? '').toLowerCase();
      const placeholder = (inputEl.placeholder ?? '').toLowerCase();

      // Check if the input is related to a captcha
      const isCaptchaInput =
        name.includes('captcha') ||
        id.includes('captcha') ||
        placeholder.includes('captcha') ||
        placeholder.includes('verification') ||
        placeholder.includes('security code');

      if (!isCaptchaInput) {
        // Check associated label
        const label = inputEl.labels?.[0];
        const labelText = (label?.textContent ?? '').toLowerCase();
        if (!labelText.includes('captcha') && !labelText.includes('verification')) {
          continue;
        }
      }

      // Look for an image near this input
      const parent = inputEl.closest('form') ?? inputEl.parentElement?.parentElement;
      if (!parent) continue;

      const images = parent.querySelectorAll('img');
      for (const img of images) {
        const src = (img.src ?? '').toLowerCase();
        const alt = (img.alt ?? '').toLowerCase();
        const imgId = (img.id ?? '').toLowerCase();

        if (
          src.includes('captcha') ||
          alt.includes('captcha') ||
          imgId.includes('captcha') ||
          src.includes('verification') ||
          src.includes('security')
        ) {
          const inputSelector = inputEl.id
            ? `#${inputEl.id}`
            : inputEl.name
              ? `input[name="${inputEl.name}"]`
              : 'input[type="text"]';

          return {
            type: 'image' as const,
            siteKey: '',
            pageUrl: pUrl,
            isInvisible: false,
            selector: img.id ? `#${img.id}` : 'img[src*="captcha"]',
            imageSource: img.src,
            inputSelector,
          };
        }
      }
    }

    return null;
  }, pageUrl);
}
