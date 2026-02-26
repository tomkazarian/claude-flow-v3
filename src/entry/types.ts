/**
 * Type definitions for the entry automation module.
 * These types define profiles, entry flows, form analysis,
 * strategies, and result tracking.
 */

import type { ContestType, EntryMethod, EntryStatus } from '../shared/constants.js';

// ---------------------------------------------------------------------------
// Profile (user identity for form filling)
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  dateOfBirth: string;
  gender?: string;
}

// ---------------------------------------------------------------------------
// Contest (enriched, ready for entry)
// ---------------------------------------------------------------------------

export interface Contest {
  id: string;
  url: string;
  title: string;
  sponsor: string;
  type: ContestType | string;
  entryMethod: EntryMethod | string;
  endDate: Date | null;
  prizeDescription: string;
  prizeValue: number | null;
  entryFrequency: string;
  ageRequirement: number | null;
  geoRestrictions: string[];
  termsUrl: string | null;
  hasCaptcha: boolean;
  requiresEmailConfirm: boolean;
  legitimacyScore: number;
  status: string;
}

// ---------------------------------------------------------------------------
// Entry options & results
// ---------------------------------------------------------------------------

export interface EntryOptions {
  /** Timeout for the entire entry flow in milliseconds. */
  timeoutMs?: number;
  /** Whether to take screenshots during the flow. */
  takeScreenshots?: boolean;
  /** Whether to check newsletter/opt-in boxes for bonus entries. */
  checkNewsletterForBonus?: boolean;
  /** Whether to share data with partners. */
  shareDataWithPartners?: boolean;
  /** Proxy configuration override. */
  proxyId?: string;
  /** Maximum number of retries on failure. */
  maxRetries?: number;
}

export interface EntryResult {
  /** Unique entry identifier. */
  entryId: string;
  /** Contest identifier. */
  contestId: string;
  /** Profile used for entry. */
  profileId: string;
  /** Final status of the entry. */
  status: EntryStatus;
  /** Human-readable result message. */
  message: string;
  /** Confirmation number if provided by the contest. */
  confirmationNumber?: string;
  /** Path to the screenshot of the result page. */
  screenshotPath?: string;
  /** Timestamp of entry attempt. */
  timestamp: string;
  /** Duration of the entry flow in milliseconds. */
  durationMs: number;
  /** For instant-win contests. */
  instantWinResult?: InstantWinResult;
  /** Errors encountered during the flow. */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Form analysis
// ---------------------------------------------------------------------------

export interface FormField {
  /** CSS selector that uniquely identifies this field on the page. */
  selector: string;
  /** The <input>/<select>/<textarea> type attribute. */
  type: string;
  /** The name attribute. */
  name: string;
  /** The id attribute. */
  id: string;
  /** The placeholder text. */
  placeholder: string;
  /** Label text associated with the field. */
  label: string;
  /** The autocomplete attribute. */
  autocomplete: string;
  /** Whether the field is required. */
  required: boolean;
  /** Available options for select/radio fields. */
  options?: SelectOption[];
}

export interface SelectOption {
  value: string;
  text: string;
}

export interface AnalyzedField extends FormField {
  /** Which profile field this form field maps to. */
  mappedProfileField: string;
  /** Confidence of the mapping (0-1). */
  confidence: number;
}

export interface FormAnalysis {
  /** All detected and analyzed form fields. */
  fields: AnalyzedField[];
  /** CSS selector for the submit button. */
  submitButton: string;
  /** CSS selector for the form element. */
  formSelector: string;
  /** Whether this form spans multiple steps. */
  isMultiStep: boolean;
  /** Whether a terms/conditions checkbox was detected. */
  hasTermsCheckbox: boolean;
  /** Whether a CAPTCHA was detected within the form. */
  hasCaptcha: boolean;
  /** Whether a file upload field was detected. */
  hasFileUpload: boolean;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

export interface FieldMapping {
  /** CSS selector for the field. */
  selector: string;
  /** Value to fill into the field. */
  value: string;
  /** Field type (text, select, radio, checkbox, etc.). */
  type: string;
  /** Interaction method to use. */
  method: 'type' | 'select' | 'click' | 'check';
}

// ---------------------------------------------------------------------------
// Multi-step handling
// ---------------------------------------------------------------------------

export interface StepInfo {
  /** Current step number. */
  currentStep: number;
  /** Total steps (if detectable). */
  totalSteps: number | null;
  /** Whether there is a next step. */
  hasNext: boolean;
  /** Selector for the next/continue button. */
  nextButtonSelector: string | null;
}

// ---------------------------------------------------------------------------
// Instant-win games
// ---------------------------------------------------------------------------

export interface InstantWinResult {
  /** Whether the game was played. */
  played: boolean;
  /** Whether the user won. */
  won: boolean;
  /** Prize description if the user won. */
  prize?: string;
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

export interface ConfirmationResult {
  /** Whether the entry was confirmed successful. */
  success: boolean;
  /** Status message from the confirmation page. */
  message: string;
  /** Confirmation/reference number if provided. */
  confirmationNumber?: string;
  /** Path to the confirmation screenshot. */
  screenshotPath: string;
}

// ---------------------------------------------------------------------------
// Entry strategy interface
// ---------------------------------------------------------------------------

export interface EntryStrategy {
  /** Human-readable name for logging. */
  readonly name: string;
  /** Execute the entry strategy for the given contest and profile. */
  execute(context: EntryContext): Promise<EntryResult>;
}

export interface EntryContext {
  /** The Playwright page object. */
  page: Page;
  /** The contest to enter. */
  contest: Contest;
  /** The profile to use for form filling. */
  profile: Profile;
  /** Entry options. */
  options: Required<EntryOptions>;
  /** Unique entry ID for this attempt. */
  entryId: string;
}

// ---------------------------------------------------------------------------
// Entry recording
// ---------------------------------------------------------------------------

export interface EntryRecord {
  id: string;
  contestId: string;
  profileId: string;
  status: EntryStatus;
  message: string;
  confirmationNumber?: string;
  screenshotPath?: string;
  durationMs: number;
  errors: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EntryLimitRecord {
  contestId: string;
  profileId: string;
  entryCount: number;
  lastEnteredAt: string;
  nextEligibleAt: string | null;
}

// ---------------------------------------------------------------------------
// Playwright page type alias (avoids direct playwright import in types)
// ---------------------------------------------------------------------------

/**
 * Represents a Playwright Page object.
 * We use an interface here to avoid coupling type definitions to the
 * playwright package directly. Concrete implementations import the
 * real type from playwright.
 */
export interface Page {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  content(): Promise<string>;
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(timeout: number): Promise<void>;
  waitForNavigation(options?: Record<string, unknown>): Promise<unknown>;
  waitForLoadState(state?: string, options?: Record<string, unknown>): Promise<void>;
  $(selector: string): Promise<unknown>;
  $$(selector: string): Promise<unknown[]>;
  evaluate<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
  click(selector: string, options?: Record<string, unknown>): Promise<void>;
  fill(selector: string, value: string, options?: Record<string, unknown>): Promise<void>;
  type(selector: string, text: string, options?: Record<string, unknown>): Promise<void>;
  selectOption(selector: string, values: string | string[], options?: Record<string, unknown>): Promise<string[]>;
  check(selector: string, options?: Record<string, unknown>): Promise<void>;
  uncheck(selector: string, options?: Record<string, unknown>): Promise<void>;
  screenshot(options?: Record<string, unknown>): Promise<Buffer>;
  isVisible(selector: string): Promise<boolean>;
  isChecked(selector: string): Promise<boolean>;
  textContent(selector: string): Promise<string | null>;
  getAttribute(selector: string, name: string): Promise<string | null>;
  innerHTML(selector: string): Promise<string>;
  mouse: {
    move(x: number, y: number, options?: Record<string, unknown>): Promise<void>;
    down(options?: Record<string, unknown>): Promise<void>;
    up(options?: Record<string, unknown>): Promise<void>;
    click(x: number, y: number, options?: Record<string, unknown>): Promise<void>;
  };
  keyboard: {
    type(text: string, options?: Record<string, unknown>): Promise<void>;
    press(key: string, options?: Record<string, unknown>): Promise<void>;
  };
  frames(): unknown[];
  mainFrame(): unknown;
  setDefaultTimeout(timeout: number): void;
  isClosed(): boolean;
}
