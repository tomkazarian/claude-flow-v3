/**
 * Common page interaction utilities for Playwright pages.
 * Provides high-level helpers for navigation, form detection,
 * element visibility checks, link extraction, and screenshots.
 */

import type { Page, ElementHandle } from 'playwright';
import { getLogger } from '../shared/logger.js';

const logger = getLogger('browser', { component: 'page-utils' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavigationOptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface FormField {
  type: string;
  name: string;
  id: string;
  label: string;
  required: boolean;
  value: string;
  options?: string[];
  selector: string;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the page to complete navigation.
 */
export async function waitForNavigation(
  page: Page,
  options?: NavigationOptions,
): Promise<void> {
  const timeout = options?.timeout ?? 30_000;
  const waitUntil = options?.waitUntil ?? 'domcontentloaded';

  try {
    await page.waitForLoadState(waitUntil, { timeout });
  } catch (error) {
    logger.warn({ error, timeout, waitUntil }, 'Navigation wait timed out');
    throw error;
  }
}

/**
 * Wait for a selector to appear on the page.
 * Returns null if the selector does not appear within the timeout.
 */
export async function waitForSelector(
  page: Page,
  selector: string,
  timeout = 10_000,
): Promise<ElementHandle | null> {
  try {
    const element = await page.waitForSelector(selector, {
      state: 'visible',
      timeout,
    });
    return element;
  } catch {
    logger.debug({ selector, timeout }, 'Selector not found within timeout');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

/**
 * Extract all visible text content from the page body.
 */
export async function getPageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const body = document.body;
    if (!body) return '';

    // Walk the DOM and collect visible text
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const tag = parent.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') {
          return NodeFilter.FILTER_REJECT;
        }

        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const parts: string[] = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      if (text) {
        parts.push(text);
      }
    }

    return parts.join(' ');
  });
}

/**
 * Detect all form fields on the page with their metadata.
 */
export async function getFormFields(page: Page): Promise<FormField[]> {
  return page.evaluate(() => {
    const fields: Array<{
      type: string;
      name: string;
      id: string;
      label: string;
      required: boolean;
      value: string;
      options?: string[];
      selector: string;
      placeholder?: string;
    }> = [];

    function findLabel(el: HTMLElement): string {
      // Try explicit label via for/id
      if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) return label.textContent?.trim() ?? '';
      }
      // Try wrapping label
      const parentLabel = el.closest('label');
      if (parentLabel) {
        // Get label text excluding the input itself
        const clone = parentLabel.cloneNode(true) as HTMLElement;
        const inputs = clone.querySelectorAll('input, select, textarea');
        inputs.forEach(i => i.remove());
        return clone.textContent?.trim() ?? '';
      }
      // Try aria-label
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;
      // Try preceding sibling text
      const prev = el.previousElementSibling;
      if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN')) {
        return prev.textContent?.trim() ?? '';
      }
      return '';
    }

    function buildSelector(el: HTMLElement): string {
      if (el.id) return `#${el.id}`;
      if (el.getAttribute('name')) return `[name="${el.getAttribute('name')}"]`;
      // Fallback: tag + nth-of-type
      const tag = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.querySelectorAll(tag));
        const idx = siblings.indexOf(el);
        if (idx >= 0) return `${tag}:nth-of-type(${idx + 1})`;
      }
      return tag;
    }

    // Inputs
    const inputs = document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
    for (const input of inputs) {
      fields.push({
        type: input.type || 'text',
        name: input.name,
        id: input.id,
        label: findLabel(input),
        required: input.required || input.getAttribute('aria-required') === 'true',
        value: input.value,
        selector: buildSelector(input),
        placeholder: input.placeholder || undefined,
      });
    }

    // Selects
    const selects = document.querySelectorAll<HTMLSelectElement>('select');
    for (const select of selects) {
      const opts = Array.from(select.options)
        .filter(o => o.value)
        .map(o => o.value);
      fields.push({
        type: 'select',
        name: select.name,
        id: select.id,
        label: findLabel(select),
        required: select.required || select.getAttribute('aria-required') === 'true',
        value: select.value,
        options: opts,
        selector: buildSelector(select),
      });
    }

    // Textareas
    const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');
    for (const textarea of textareas) {
      fields.push({
        type: 'textarea',
        name: textarea.name,
        id: textarea.id,
        label: findLabel(textarea),
        required: textarea.required || textarea.getAttribute('aria-required') === 'true',
        value: textarea.value,
        selector: buildSelector(textarea),
        placeholder: textarea.placeholder || undefined,
      });
    }

    return fields;
  });
}

// ---------------------------------------------------------------------------
// Element helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a selector is visible on the page.
 */
export async function isVisible(page: Page, selector: string): Promise<boolean> {
  try {
    const element = await page.$(selector);
    if (!element) return false;
    return element.isVisible();
  } catch {
    return false;
  }
}

/**
 * Scroll an element into view.
 */
export async function scrollToElement(page: Page, selector: string): Promise<void> {
  const element = await page.$(selector);
  if (!element) {
    logger.debug({ selector }, 'Element not found for scrollToElement');
    return;
  }
  await element.scrollIntoViewIfNeeded();
}

/**
 * Click a selector and wait for the resulting navigation to complete.
 */
export async function clickAndWaitForNavigation(
  page: Page,
  selector: string,
): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ timeout: 30_000, waitUntil: 'domcontentloaded' }),
    page.click(selector),
  ]);
}

// ---------------------------------------------------------------------------
// Link / text helpers
// ---------------------------------------------------------------------------

/**
 * Extract all anchor href values from the page, optionally filtered by a regex.
 */
export async function extractLinks(page: Page, pattern?: RegExp): Promise<string[]> {
  const allLinks = await page.evaluate(() => {
    const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
    return Array.from(anchors)
      .map(a => a.href)
      .filter(href => href && !href.startsWith('javascript:'));
  });

  if (pattern) {
    return allLinks.filter(link => pattern.test(link));
  }
  return allLinks;
}

/**
 * Check whether the page contains a given text string (case-insensitive).
 */
export async function hasText(page: Page, text: string): Promise<boolean> {
  const pageText = await getPageText(page);
  return pageText.toLowerCase().includes(text.toLowerCase());
}

// ---------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------

/**
 * Take a full-page screenshot and return the file path.
 */
export async function takeScreenshot(page: Page, path: string): Promise<string> {
  await page.screenshot({
    path,
    fullPage: true,
    type: 'png',
  });
  logger.debug({ path }, 'Screenshot captured');
  return path;
}
