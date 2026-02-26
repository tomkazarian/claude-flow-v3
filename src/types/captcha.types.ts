import { z } from "zod";

// ---------------------------------------------------------------------------
// String literal unions
// ---------------------------------------------------------------------------

export type CaptchaType =
  | "recaptcha_v2"
  | "recaptcha_v3"
  | "hcaptcha"
  | "funcaptcha"
  | "turnstile"
  | "image"
  | "text"
  | "audio"
  | "slider";

export type CaptchaProvider =
  | "2captcha"
  | "anticaptcha"
  | "capmonster"
  | "capsolver"
  | "deathbycaptcha";

// ---------------------------------------------------------------------------
// Request / result interfaces
// ---------------------------------------------------------------------------

export interface CaptchaSolveRequest {
  /** Type of captcha to solve */
  type: CaptchaType;

  /** The sitekey provided by the captcha service on the target page */
  siteKey: string;

  /** URL of the page containing the captcha */
  pageUrl: string;

  /** Provider to use (falls back to default from config) */
  provider?: CaptchaProvider;

  /** For reCAPTCHA v3: the action parameter */
  action?: string;

  /** For reCAPTCHA v3: minimum acceptable score (0.1 - 0.9) */
  minScore?: number;

  /** Whether the captcha is invisible (reCAPTCHA v2 invisible) */
  isInvisible?: boolean;

  /** Enterprise flag for reCAPTCHA Enterprise */
  isEnterprise?: boolean;

  /** Additional data required by some captcha types */
  extraData?: Record<string, string>;

  /** Maximum time in milliseconds to wait for a solution */
  timeoutMs?: number;
}

export interface CaptchaSolveResult {
  /** Whether the captcha was solved successfully */
  success: boolean;

  /** The solution token to submit with the form */
  token: string | null;

  /** Provider that solved the captcha */
  provider: CaptchaProvider;

  /** Cost of the solve in USD */
  cost: number;

  /** Time taken to solve in milliseconds */
  solveTimeMs: number;

  /** Provider-specific task ID for reporting */
  taskId: string | null;

  /** Error message if failed */
  errorMessage: string | null;

  /** Error code from the provider */
  errorCode: string | null;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CaptchaConfig {
  /** Default provider to use when none specified */
  defaultProvider: CaptchaProvider;

  /** Maximum cost in USD per single solve attempt */
  maxCostPerSolve: number;

  /** Maximum total daily spend across all captcha solves */
  dailyBudget: number;

  /** Default timeout in milliseconds */
  defaultTimeoutMs: number;

  /** Number of retry attempts on failure */
  maxRetries: number;

  /** Provider-specific API keys (loaded from environment) */
  providerKeys: Partial<Record<CaptchaProvider, string>>;

  /** Provider priority order for fallback */
  providerPriority: CaptchaProvider[];

  /** Whether to report bad tokens back to the provider */
  reportBadTokens: boolean;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const captchaTypeSchema = z.enum([
  "recaptcha_v2",
  "recaptcha_v3",
  "hcaptcha",
  "funcaptcha",
  "turnstile",
  "image",
  "text",
  "audio",
  "slider",
]);

export const captchaProviderSchema = z.enum([
  "2captcha",
  "anticaptcha",
  "capmonster",
  "capsolver",
  "deathbycaptcha",
]);

export const captchaSolveRequestSchema = z.object({
  type: captchaTypeSchema,
  siteKey: z.string().min(1),
  pageUrl: z.string().url(),
  provider: captchaProviderSchema.optional(),
  action: z.string().optional(),
  minScore: z.number().min(0.1).max(0.9).optional(),
  isInvisible: z.boolean().optional(),
  isEnterprise: z.boolean().optional(),
  extraData: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().min(5_000).max(300_000).optional(),
});

export const captchaConfigSchema = z.object({
  defaultProvider: captchaProviderSchema,
  maxCostPerSolve: z.number().positive(),
  dailyBudget: z.number().positive(),
  defaultTimeoutMs: z.number().int().min(5_000),
  maxRetries: z.number().int().min(0).max(10),
  providerKeys: z.record(captchaProviderSchema, z.string().optional()),
  providerPriority: z.array(captchaProviderSchema).min(1),
  reportBadTokens: z.boolean(),
});
