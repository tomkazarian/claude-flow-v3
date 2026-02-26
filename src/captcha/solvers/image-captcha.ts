import type { Page } from 'playwright';
import { getLogger } from '../../shared/logger.js';
import { CaptchaError } from '../../shared/errors.js';
import type { CaptchaDetection, CaptchaServiceProvider } from '../types.js';

const log = getLogger('captcha', { component: 'solver:image-captcha' });

/**
 * Solves a simple image CAPTCHA on the given page:
 *   1. Locates the CAPTCHA image element
 *   2. Screenshots it and converts to base64
 *   3. Submits to the solving provider for OCR/recognition
 *   4. Types the solution into the associated input field
 *
 * Returns the solution text on success.
 */
export async function solveImageCaptchaOnPage(
  detection: CaptchaDetection,
  page: Page,
  provider: CaptchaServiceProvider,
): Promise<string> {
  const { selector, inputSelector, imageSource } = detection;

  log.info(
    { selector, inputSelector, hasImageSource: !!imageSource, provider: provider.name },
    'Solving image CAPTCHA',
  );

  // Get the image as base64
  const base64Image = await getImageBase64(page, selector, imageSource);

  if (!base64Image) {
    throw new CaptchaError(
      'Failed to capture CAPTCHA image',
      'CAPTCHA_IMAGE_CAPTURE_FAILED',
      'image',
      provider.name,
    );
  }

  // Submit to provider for recognition
  const solution = await provider.solveImage(base64Image);

  if (!solution) {
    throw new CaptchaError(
      'Provider returned empty solution for image CAPTCHA',
      'CAPTCHA_EMPTY_SOLUTION',
      'image',
      provider.name,
    );
  }

  // Type the solution into the input field
  await typeSolution(page, inputSelector, solution);

  log.info(
    { provider: provider.name, solutionLength: solution.length },
    'Image CAPTCHA solution typed into input',
  );

  return solution;
}

/**
 * Captures the CAPTCHA image as a base64 string. Tries multiple approaches:
 *   1. If imageSource is a data URI, extract the base64 portion directly
 *   2. Screenshot the image element using the selector
 *   3. Fetch the image URL and convert to base64
 */
async function getImageBase64(
  page: Page,
  selector: string,
  imageSource?: string,
): Promise<string | null> {
  // If the image source is already a data URI
  if (imageSource?.startsWith('data:image/')) {
    const base64Match = imageSource.match(/^data:image\/[^;]+;base64,(.+)$/);
    if (base64Match?.[1]) {
      log.debug('Using data URI for CAPTCHA image');
      return base64Match[1];
    }
  }

  // Try to screenshot the image element
  try {
    const element = await page.$(selector);
    if (element) {
      const screenshot = await element.screenshot({ type: 'png' });
      const base64 = screenshot.toString('base64');
      log.debug({ selector }, 'Captured CAPTCHA image via element screenshot');
      return base64;
    }
  } catch (error) {
    log.debug(
      { selector, error: error instanceof Error ? error.message : String(error) },
      'Failed to screenshot element, trying alternative methods',
    );
  }

  // Try fetching the image URL from the page
  if (imageSource && !imageSource.startsWith('data:')) {
    try {
      const base64 = await page.evaluate(async (src: string) => {
        const response = await fetch(src);
        const blob = await response.blob();

        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            const base64Data = result.split(',')[1];
            if (base64Data) {
              resolve(base64Data);
            } else {
              reject(new Error('Failed to extract base64 from blob'));
            }
          };
          reader.onerror = () => reject(new Error('FileReader error'));
          reader.readAsDataURL(blob);
        });
      }, imageSource);

      if (base64) {
        log.debug('Captured CAPTCHA image via fetch');
        return base64;
      }
    } catch (error) {
      log.debug(
        { imageSource, error: error instanceof Error ? error.message : String(error) },
        'Failed to fetch CAPTCHA image',
      );
    }
  }

  // Last resort: try to find any captcha-related image and screenshot it
  try {
    const fallbackSelectors = [
      'img[src*="captcha"]',
      'img[id*="captcha"]',
      'img[class*="captcha"]',
      'img[alt*="captcha"]',
      '.captcha img',
      '#captcha img',
    ];

    for (const fallback of fallbackSelectors) {
      const element = await page.$(fallback);
      if (element) {
        const screenshot = await element.screenshot({ type: 'png' });
        log.debug({ fallbackSelector: fallback }, 'Captured CAPTCHA image via fallback selector');
        return screenshot.toString('base64');
      }
    }
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'All image capture methods failed',
    );
  }

  return null;
}

/**
 * Types the CAPTCHA solution into the designated input field.
 * Uses human-like typing with small delays between characters.
 */
async function typeSolution(
  page: Page,
  inputSelector: string | undefined,
  solution: string,
): Promise<void> {
  // Determine the input selector
  const selector = inputSelector ?? findCaptchaInputSelector();

  if (!selector) {
    throw new CaptchaError(
      'No input selector found for image CAPTCHA solution',
      'CAPTCHA_INPUT_NOT_FOUND',
      'image',
      'unknown',
    );
  }

  // Clear the existing value
  const input = await page.$(selector);
  if (!input) {
    throw new CaptchaError(
      `CAPTCHA input element not found: ${selector}`,
      'CAPTCHA_INPUT_NOT_FOUND',
      'image',
      'unknown',
    );
  }

  // Clear existing text
  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');

  // Type with slight delay to appear human-like
  await input.type(solution, { delay: 50 + Math.random() * 50 });

  log.debug({ selector, solutionLength: solution.length }, 'Typed CAPTCHA solution');
}

/**
 * Returns a default selector for common CAPTCHA input field patterns.
 */
function findCaptchaInputSelector(): string {
  return 'input[name*="captcha"], input[id*="captcha"], input[placeholder*="captcha"]';
}
