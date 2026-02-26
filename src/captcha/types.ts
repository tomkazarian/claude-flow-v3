/**
 * Shared type definitions for the CAPTCHA module.
 */

export type CaptchaType =
  | 'recaptcha-v2'
  | 'recaptcha-v3'
  | 'hcaptcha'
  | 'turnstile'
  | 'funcaptcha'
  | 'image';

export interface CaptchaDetection {
  type: CaptchaType;
  siteKey: string;
  pageUrl: string;
  isInvisible: boolean;
  selector: string;
  /** For reCAPTCHA v3, the action name */
  action?: string;
  /** For image CAPTCHAs, the image source URL or data URI */
  imageSource?: string;
  /** Selector for the input field where the solution should be typed */
  inputSelector?: string;
}

export interface CaptchaSolveResult {
  success: boolean;
  token?: string;
  solution?: string;
  durationMs: number;
  cost: number;
  provider: string;
  error?: string;
}

export interface CaptchaServiceProvider {
  readonly name: string;
  readonly priority: number;

  solveRecaptchaV2(siteKey: string, pageUrl: string, isInvisible?: boolean): Promise<string>;
  solveRecaptchaV3(siteKey: string, pageUrl: string, action?: string, minScore?: number): Promise<string>;
  solveHCaptcha(siteKey: string, pageUrl: string): Promise<string>;
  solveTurnstile(siteKey: string, pageUrl: string): Promise<string>;
  solveImage(base64Image: string): Promise<string>;
  getBalance(): Promise<number>;
  reportGood?(taskId: string): Promise<void>;
  reportBad?(taskId: string): Promise<void>;
}

export interface CaptchaSolverConfig {
  /** Ordered list of provider names to try. First provider is tried first. */
  providerPriority?: string[];
  /** Maximum time to wait for a CAPTCHA solve in milliseconds. Default: 120000 */
  timeoutMs?: number;
  /** Maximum number of providers to try before giving up. Default: 2 */
  maxProviderRetries?: number;
}
