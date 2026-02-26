/**
 * Form filler - fills form fields with profile data using human-like interactions.
 *
 * Handles all input types (text, email, tel, select, radio, checkbox,
 * date, textarea) with realistic typing delays, scrolling, and clicking.
 */

import { getLogger } from '../shared/logger.js';
import {
  humanClickDelay,
  humanScrollDelay,
  gaussianDelay,
  sleep,
} from '../shared/timing.js';
import type { Page, FormAnalysis, FieldMapping, Profile } from './types.js';
import { FieldMapper } from './field-mapper.js';

const log = getLogger('entry', { component: 'form-filler' });

/** Delay between filling each field (ms). */
const INTER_FIELD_DELAY_MEAN_MS = 400;
const INTER_FIELD_DELAY_STDDEV_MS = 150;

/** Per-character typing delay (ms). */
const TYPING_DELAY_MIN_MS = 40;
const TYPING_DELAY_MAX_MS = 120;

export class FormFiller {
  private readonly fieldMapper = new FieldMapper();

  /**
   * Fill all form fields with profile data using human-like interactions.
   */
  async fillForm(
    page: Page,
    analysis: FormAnalysis,
    profile: Profile,
  ): Promise<void> {
    log.info(
      { fieldCount: analysis.fields.length, formSelector: analysis.formSelector },
      'Starting form fill',
    );

    const mappings = this.fieldMapper.mapFields(analysis.fields, profile);

    if (mappings.length === 0) {
      log.warn('No field mappings generated, form may be empty or unrecognized');
      return;
    }

    for (const mapping of mappings) {
      try {
        await this.fillField(page, mapping);
        await gaussianDelay(INTER_FIELD_DELAY_MEAN_MS, INTER_FIELD_DELAY_STDDEV_MS);
      } catch (error) {
        log.error(
          {
            selector: mapping.selector,
            method: mapping.method,
            error: error instanceof Error ? error.message : String(error),
          },
          'Failed to fill field',
        );
        // Continue with remaining fields rather than aborting
      }
    }

    log.info({ filledCount: mappings.length }, 'Form fill complete');
  }

  /**
   * Fill a single form field.
   */
  private async fillField(page: Page, mapping: FieldMapping): Promise<void> {
    const { selector, value, method } = mapping;

    if (!value) {
      log.debug({ selector }, 'Skipping field with empty value');
      return;
    }

    // Scroll the field into view
    await this.scrollToElement(page, selector);
    await humanScrollDelay();

    switch (method) {
      case 'type':
        await this.typeIntoField(page, selector, value);
        break;

      case 'select':
        await this.selectOption(page, selector, value);
        break;

      case 'click':
        await this.clickOption(page, selector, value);
        break;

      case 'check':
        await this.checkField(page, selector);
        break;

      default:
        log.warn({ selector, method }, 'Unknown fill method, falling back to type');
        await this.typeIntoField(page, selector, value);
    }

    log.debug({ selector, method, valueLength: value.length }, 'Field filled');
  }

  /**
   * Type text into a field with human-like keystroke timing.
   */
  private async typeIntoField(page: Page, selector: string, value: string): Promise<void> {
    // Click the field to focus it
    await humanClickDelay();
    await page.click(selector);

    // Clear existing value by selecting all and deleting
    await this.clearField(page, selector);
    await sleep(100);

    // Type each character with varying delay
    const typingDelay = this.randomBetween(TYPING_DELAY_MIN_MS, TYPING_DELAY_MAX_MS);
    await page.type(selector, value, { delay: typingDelay });
  }

  /**
   * Select an option from a dropdown/select element.
   */
  private async selectOption(page: Page, selector: string, value: string): Promise<void> {
    await humanClickDelay();

    try {
      // Try selecting by value first
      await page.selectOption(selector, value);
    } catch {
      // If that fails, try selecting by label text
      try {
        await page.selectOption(selector, { label: value } as unknown as string);
      } catch {
        // Last resort: try partial text match via evaluate
        await page.evaluate(
          (args: unknown) => {
            const [sel, val] = args as [string, string];
            const select = document.querySelector(sel) as HTMLSelectElement | null;
            if (!select) return;

            const valLower = val.toLowerCase();
            for (const opt of select.options) {
              if (
                opt.value.toLowerCase() === valLower ||
                opt.text.toLowerCase() === valLower ||
                opt.text.toLowerCase().includes(valLower) ||
                opt.value.toLowerCase().includes(valLower)
              ) {
                select.value = opt.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                return;
              }
            }
          },
          [selector, value],
        );
      }
    }
  }

  /**
   * Click a radio button option that matches the value.
   */
  private async clickOption(page: Page, selector: string, value: string): Promise<void> {
    await humanClickDelay();

    // For radio buttons, find the one with the matching value
    try {
      const radioSelector = `${selector}[value="${value}"]`;
      await page.click(radioSelector);
    } catch {
      // Try finding by value attribute in the group
      await page.evaluate(
        (args: unknown) => {
          const [sel, val] = args as [string, string];
          const radios = document.querySelectorAll(`input[name="${sel.replace(/[[\]]/g, '')}"]`);
          const valLower = val.toLowerCase();

          for (const radio of radios) {
            const inputRadio = radio as HTMLInputElement;
            const label = radio.closest('label')?.textContent?.toLowerCase() ?? '';
            if (
              inputRadio.value.toLowerCase() === valLower ||
              label.includes(valLower)
            ) {
              inputRadio.click();
              return;
            }
          }
        },
        [selector, value],
      );
    }
  }

  /**
   * Check a checkbox.
   */
  private async checkField(page: Page, selector: string): Promise<void> {
    await humanClickDelay();

    try {
      const isChecked = await page.isChecked(selector);
      if (!isChecked) {
        await page.check(selector);
      }
    } catch {
      // Fall back to clicking
      await page.click(selector);
    }
  }

  /**
   * Clear an input field's existing value.
   */
  private async clearField(page: Page, selector: string): Promise<void> {
    try {
      // Triple-click to select all text, then delete
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press('Backspace');
    } catch {
      // Alternative: use fill with empty string
      try {
        await page.fill(selector, '');
      } catch {
        // Last resort: use keyboard shortcuts
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Backspace');
      }
    }
  }

  /**
   * Scroll an element into the viewport.
   */
  private async scrollToElement(page: Page, selector: string): Promise<void> {
    try {
      await page.evaluate(
        (sel: unknown) => {
          const el = document.querySelector(sel as string);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        },
        selector,
      );
    } catch {
      // Scrolling is best-effort
    }
  }

  /**
   * Generate a random number between min and max (inclusive).
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
