/**
 * Form analyzer - inspects a page to detect and classify form fields.
 *
 * Examines labels, names, IDs, placeholders, types, and autocomplete
 * attributes to determine each field's purpose and map it to the
 * correct profile data field.
 */

import { getLogger } from '../shared/logger.js';
import type { Page, FormAnalysis, AnalyzedField, FormField } from './types.js';

const log = getLogger('entry', { component: 'form-analyzer' });

// ---------------------------------------------------------------------------
// Field mapping patterns
// ---------------------------------------------------------------------------

interface FieldPattern {
  profileField: string;
  patterns: RegExp[];
  autocompleteValues: string[];
}

const FIELD_PATTERNS: FieldPattern[] = [
  {
    profileField: 'firstName',
    patterns: [
      /first[\s_-]?name/i, /fname/i, /given[\s_-]?name/i,
      /\bfirst\b/i, /\bforename\b/i,
    ],
    autocompleteValues: ['given-name', 'first-name'],
  },
  {
    profileField: 'lastName',
    patterns: [
      /last[\s_-]?name/i, /lname/i, /sur[\s_-]?name/i,
      /family[\s_-]?name/i, /\blast\b/i,
    ],
    autocompleteValues: ['family-name', 'last-name', 'surname'],
  },
  {
    profileField: 'fullName',
    patterns: [
      /full[\s_-]?name/i, /\bname\b/i, /your[\s_-]?name/i,
      /^name$/i, /participant[\s_-]?name/i,
    ],
    autocompleteValues: ['name'],
  },
  {
    profileField: 'email',
    patterns: [
      /e[\s_-]?mail/i, /email[\s_-]?address/i, /\bemail\b/i,
    ],
    autocompleteValues: ['email'],
  },
  {
    profileField: 'phone',
    patterns: [
      /phone/i, /tel(?:ephone)?/i, /mobile/i, /cell/i,
      /contact[\s_-]?number/i,
    ],
    autocompleteValues: ['tel', 'phone', 'mobile'],
  },
  {
    profileField: 'addressLine1',
    patterns: [
      /address[\s_-]?(?:line[\s_-]?)?1?$/i, /street[\s_-]?address/i,
      /mailing[\s_-]?address/i, /\baddress\b/i, /addr1/i,
    ],
    autocompleteValues: ['address-line1', 'street-address'],
  },
  {
    profileField: 'addressLine2',
    patterns: [
      /address[\s_-]?(?:line[\s_-]?)?2/i, /apt/i, /suite/i,
      /unit/i, /addr2/i,
    ],
    autocompleteValues: ['address-line2'],
  },
  {
    profileField: 'city',
    patterns: [/\bcity\b/i, /\btown\b/i, /municipality/i],
    autocompleteValues: ['address-level2'],
  },
  {
    profileField: 'state',
    patterns: [
      /\bstate\b/i, /\bprovince\b/i, /\bregion\b/i,
    ],
    autocompleteValues: ['address-level1'],
  },
  {
    profileField: 'zip',
    patterns: [
      /zip[\s_-]?(?:code)?/i, /postal[\s_-]?code/i, /\bzip\b/i,
      /\bpostal\b/i, /postcode/i,
    ],
    autocompleteValues: ['postal-code', 'zip-code'],
  },
  {
    profileField: 'country',
    patterns: [/\bcountry\b/i, /\bnation\b/i],
    autocompleteValues: ['country', 'country-name'],
  },
  {
    profileField: 'dateOfBirth',
    patterns: [
      /date[\s_-]?of[\s_-]?birth/i, /\bdob\b/i, /birth[\s_-]?date/i,
      /birthday/i, /\bbirth\b/i,
    ],
    autocompleteValues: ['bday'],
  },
  {
    profileField: 'gender',
    patterns: [/\bgender\b/i, /\bsex\b/i],
    autocompleteValues: ['sex'],
  },
  {
    profileField: 'age',
    patterns: [/\bage\b/i, /how[\s_-]?old/i],
    autocompleteValues: [],
  },
];

// ---------------------------------------------------------------------------
// CAPTCHA detection
// ---------------------------------------------------------------------------

const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
  '.g-recaptcha', '.h-captcha', '[data-sitekey]',
  '#captcha', '.captcha', '.cf-turnstile',
];

// ---------------------------------------------------------------------------
// Submit button detection
// ---------------------------------------------------------------------------

const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:not([type])',
  'button.submit',
  'button.btn-submit',
  'input[type="button"][value*="submit" i]',
  'input[type="button"][value*="enter" i]',
  'button[id*="submit" i]',
  'button[class*="submit" i]',
  'a.submit-button',
  'a.btn-submit',
];

export class FormAnalyzer {
  /**
   * Analyze all forms on the page and return a comprehensive analysis.
   */
  async analyzeForm(page: Page): Promise<FormAnalysis> {
    log.info('Analyzing form fields on page');

    const fields = await this.detectFields(page);
    const analyzedFields = this.classifyFields(fields);
    const submitButton = await this.findSubmitButton(page);
    const formSelector = await this.findFormSelector(page);
    const isMultiStep = await this.detectMultiStep(page);
    const hasTermsCheckbox = await this.detectTermsCheckbox(page);
    const hasCaptcha = await this.detectCaptcha(page);
    const hasFileUpload = await this.detectFileUpload(page);

    const analysis: FormAnalysis = {
      fields: analyzedFields,
      submitButton,
      formSelector,
      isMultiStep,
      hasTermsCheckbox,
      hasCaptcha,
      hasFileUpload,
    };

    log.info(
      {
        fieldCount: analyzedFields.length,
        submitButton,
        isMultiStep,
        hasTermsCheckbox,
        hasCaptcha,
      },
      'Form analysis complete',
    );

    return analysis;
  }

  /**
   * Detect all form fields on the page.
   */
  private async detectFields(page: Page): Promise<FormField[]> {
    const fields: FormField[] = await page.evaluate(() => {
      const result: Array<{
        selector: string;
        type: string;
        name: string;
        id: string;
        placeholder: string;
        label: string;
        autocomplete: string;
        required: boolean;
        options: Array<{ value: string; text: string }>;
      }> = [];

      // Find all input, select, and textarea elements inside forms
      const elements = document.querySelectorAll(
        'form input, form select, form textarea, input, select, textarea',
      );

      const seen = new Set<string>();

      elements.forEach((el) => {
        const htmlEl = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const type = htmlEl.type?.toLowerCase() ?? htmlEl.tagName.toLowerCase();

        // Skip hidden and submit inputs
        if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') {
          return;
        }

        // Skip honeypot fields that are visually hidden via CSS
        const style = window.getComputedStyle(htmlEl);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0' ||
          htmlEl.offsetWidth === 0 ||
          htmlEl.offsetHeight === 0
        ) {
          return;
        }

        // Skip fields positioned off-screen (common honeypot technique)
        if (style.position === 'absolute') {
          const left = parseInt(style.left, 10);
          const top = parseInt(style.top, 10);
          if (
            (!isNaN(left) && left < -1000) ||
            (!isNaN(top) && top < -1000)
          ) {
            return;
          }
        }

        const name = htmlEl.name ?? '';
        const id = htmlEl.id ?? '';
        const placeholder = (htmlEl as HTMLInputElement).placeholder ?? '';
        const autocomplete = htmlEl.autocomplete ?? '';
        const required = htmlEl.required ?? false;

        // Build a unique selector
        let selector = '';
        if (id) {
          selector = `#${CSS.escape(id)}`;
        } else if (name) {
          selector = `[name="${CSS.escape(name)}"]`;
        } else {
          return; // Cannot target this field
        }

        if (seen.has(selector)) return;
        seen.add(selector);

        // Find associated label
        let label = '';
        if (id) {
          const labelEl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (labelEl) {
            label = labelEl.textContent?.trim() ?? '';
          }
        }
        if (!label) {
          const parent = htmlEl.closest('label');
          if (parent) {
            label = parent.textContent?.trim() ?? '';
          }
        }
        if (!label) {
          // Look at previous sibling or aria-label
          label = htmlEl.getAttribute('aria-label') ?? '';
        }

        // Extract options for select elements
        const options: Array<{ value: string; text: string }> = [];
        if (htmlEl.tagName === 'SELECT') {
          const selectEl = htmlEl as HTMLSelectElement;
          for (const opt of selectEl.options) {
            if (opt.value) {
              options.push({ value: opt.value, text: opt.textContent?.trim() ?? '' });
            }
          }
        }

        result.push({
          selector,
          type,
          name,
          id,
          placeholder,
          label,
          autocomplete,
          required,
          options: options.length > 0 ? options : [],
        });
      });

      return result;
    }) as FormField[];

    return fields;
  }

  /**
   * Classify detected fields by mapping them to profile data fields.
   */
  private classifyFields(fields: FormField[]): AnalyzedField[] {
    return fields.map((field) => {
      const { profileField, confidence } = this.identifyField(field);
      return {
        ...field,
        mappedProfileField: profileField,
        confidence,
      };
    });
  }

  /**
   * Determine which profile field a form field corresponds to.
   */
  private identifyField(field: FormField): { profileField: string; confidence: number } {
    // Build a searchable text from all field attributes
    const searchText = [
      field.name,
      field.id,
      field.placeholder,
      field.label,
      field.autocomplete,
    ].join(' ');

    let bestMatch = { profileField: 'unknown', confidence: 0 };

    for (const pattern of FIELD_PATTERNS) {
      // Check autocomplete attribute first (highest confidence)
      if (field.autocomplete) {
        const autoLower = field.autocomplete.toLowerCase();
        for (const autoVal of pattern.autocompleteValues) {
          if (autoLower === autoVal || autoLower.includes(autoVal)) {
            return { profileField: pattern.profileField, confidence: 0.95 };
          }
        }
      }

      // Check patterns against combined text
      for (const regex of pattern.patterns) {
        if (regex.test(searchText)) {
          const confidence = this.computeMatchConfidence(field, pattern);
          if (confidence > bestMatch.confidence) {
            bestMatch = { profileField: pattern.profileField, confidence };
          }
        }
      }
    }

    // Special handling: email type input
    if (field.type === 'email' && bestMatch.profileField === 'unknown') {
      bestMatch = { profileField: 'email', confidence: 0.9 };
    }

    // Special handling: tel type input
    if (field.type === 'tel' && bestMatch.profileField === 'unknown') {
      bestMatch = { profileField: 'phone', confidence: 0.9 };
    }

    // Special handling: date type input
    if (field.type === 'date' && bestMatch.profileField === 'unknown') {
      bestMatch = { profileField: 'dateOfBirth', confidence: 0.7 };
    }

    return bestMatch;
  }

  /**
   * Compute a confidence score for a field-to-pattern match.
   */
  private computeMatchConfidence(field: FormField, pattern: FieldPattern): number {
    let confidence = 0.5;

    // Name attribute match is strong
    for (const regex of pattern.patterns) {
      if (regex.test(field.name)) {
        confidence += 0.2;
        break;
      }
    }

    // ID match is strong
    for (const regex of pattern.patterns) {
      if (regex.test(field.id)) {
        confidence += 0.15;
        break;
      }
    }

    // Label match
    for (const regex of pattern.patterns) {
      if (regex.test(field.label)) {
        confidence += 0.1;
        break;
      }
    }

    // Placeholder match
    for (const regex of pattern.patterns) {
      if (regex.test(field.placeholder)) {
        confidence += 0.05;
        break;
      }
    }

    return Math.min(0.95, confidence);
  }

  /**
   * Find the submit button selector.
   */
  private async findSubmitButton(page: Page): Promise<string> {
    for (const selector of SUBMIT_SELECTORS) {
      try {
        const visible = await page.isVisible(selector);
        if (visible) {
          return selector;
        }
      } catch {
        // Selector not found, continue
      }
    }

    // Try finding a button with submit-like text
    try {
      const buttonSelector = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, input[type="button"], a.btn');
        const submitTexts = ['submit', 'enter', 'sign up', 'register', 'apply', 'join', 'go', 'continue'];

        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase().trim() ?? '';
          const value = (btn as HTMLInputElement).value?.toLowerCase() ?? '';
          const combined = `${text} ${value}`;

          for (const submitText of submitTexts) {
            if (combined.includes(submitText)) {
              if (btn.id) {
                return `#${CSS.escape(btn.id)}`;
              }
              if (btn.className) {
                const classes = btn.className.split(/\s+/).map((c: string) => `.${CSS.escape(c)}`).join('');
                return `${btn.tagName.toLowerCase()}${classes}`;
              }
              return btn.tagName.toLowerCase();
            }
          }
        }
        return '';
      }) as string;

      if (buttonSelector) {
        return buttonSelector;
      }
    } catch {
      // Ignore evaluation errors
    }

    // Absolute fallback
    return 'button[type="submit"], input[type="submit"], button:not([type])';
  }

  /**
   * Find the main form element selector.
   */
  private async findFormSelector(page: Page): Promise<string> {
    try {
      const selector = await page.evaluate(() => {
        const forms = document.querySelectorAll('form');
        if (forms.length === 0) return 'body';
        if (forms.length === 1) {
          const form = forms[0]!;
          if (form.id) return `#${CSS.escape(form.id)}`;
          if (form.name) return `form[name="${CSS.escape(form.name)}"]`;
          return 'form';
        }

        // Multiple forms: find the one with the most visible inputs
        let bestForm = forms[0]!;
        let bestCount = 0;

        for (const form of forms) {
          const inputs = form.querySelectorAll('input:not([type="hidden"]), select, textarea');
          if (inputs.length > bestCount) {
            bestCount = inputs.length;
            bestForm = form;
          }
        }

        if (bestForm.id) return `#${CSS.escape(bestForm.id)}`;
        if (bestForm.name) return `form[name="${CSS.escape(bestForm.name)}"]`;
        return 'form';
      }) as string;

      return selector || 'form';
    } catch {
      return 'form';
    }
  }

  /**
   * Detect whether the form is multi-step.
   */
  private async detectMultiStep(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        const body = document.body.textContent?.toLowerCase() ?? '';

        // Look for step indicators
        const stepPattern = /step\s+\d+\s+of\s+\d+/i;
        if (stepPattern.test(body)) return true;

        // Look for progress indicators
        const progressEl = document.querySelector(
          '.progress, .steps, .wizard, .step-indicator, [class*="progress"], [class*="step"]',
        );
        if (progressEl) return true;

        // Look for "Next" buttons that do not submit
        const nextButtons = document.querySelectorAll(
          'button:not([type="submit"])',
        );
        for (const btn of nextButtons) {
          const text = btn.textContent?.toLowerCase().trim() ?? '';
          if (text === 'next' || text === 'continue' || text.includes('next step')) {
            return true;
          }
        }

        return false;
      }) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Detect whether the form has a terms/conditions checkbox.
   */
  private async detectTermsCheckbox(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        for (const cb of checkboxes) {
          const label = cb.closest('label')?.textContent?.toLowerCase() ?? '';
          const sibling = cb.nextElementSibling?.textContent?.toLowerCase() ?? '';
          const text = `${label} ${sibling}`;

          if (text.includes('terms') || text.includes('rules') || text.includes('agree') ||
              text.includes('accept') || text.includes('conditions')) {
            return true;
          }
        }
        return false;
      }) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Detect whether a CAPTCHA is present on the page.
   */
  private async detectCaptcha(page: Page): Promise<boolean> {
    for (const selector of CAPTCHA_SELECTORS) {
      try {
        const visible = await page.isVisible(selector);
        if (visible) return true;
      } catch {
        // Not found
      }
    }

    try {
      const hasCaptchaScript = await page.evaluate(() => {
        const html = document.documentElement.innerHTML.toLowerCase();
        return html.includes('recaptcha') || html.includes('hcaptcha') || html.includes('turnstile');
      }) as boolean;
      return hasCaptchaScript;
    } catch {
      return false;
    }
  }

  /**
   * Detect whether the form has a file upload field.
   */
  private async detectFileUpload(page: Page): Promise<boolean> {
    try {
      const visible = await page.isVisible('input[type="file"]');
      return visible;
    } catch {
      return false;
    }
  }
}
