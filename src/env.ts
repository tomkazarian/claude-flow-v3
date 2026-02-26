import { config } from 'dotenv';
import { z } from 'zod';

// Load .env file before validation
config();

/**
 * Schema for all environment variables consumed by the platform.
 * Required variables will cause a hard failure at startup if missing;
 * optional variables fall back to sensible defaults.
 */
const envSchema = z.object({
  // ---------- General ----------
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  PORT: z.coerce.number().int().positive().default(3000),

  // ---------- Security / Encryption ----------
  ENCRYPTION_KEY: z
    .string()
    .min(16, 'ENCRYPTION_KEY must be at least 16 characters'),

  // ---------- Database ----------
  DATABASE_PATH: z.string().default('./data/sweepstakes.db'),

  // ---------- Redis (BullMQ) ----------
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // ---------- Proxy ----------
  PROXY_LIST_URL: z.string().url().optional(),
  PROXY_ROTATION_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),

  // ---------- CAPTCHA providers ----------
  TWOCAPTCHA_API_KEY: z.string().optional(),
  ANTICAPTCHA_API_KEY: z.string().optional(),
  CAPSOLVER_API_KEY: z.string().optional(),

  // ---------- Email ----------
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().int().positive().default(993),
  IMAP_USER: z.string().optional(),
  IMAP_PASS: z.string().optional(),

  // ---------- SMS (Twilio) ----------
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // ---------- Google (discovery) ----------
  GOOGLE_API_KEY: z.string().optional(),
  GOOGLE_CSE_ID: z.string().optional(),

  // ---------- Social (OAuth) ----------
  TWITTER_API_KEY: z.string().optional(),
  TWITTER_API_SECRET: z.string().optional(),
  FACEBOOK_APP_ID: z.string().optional(),
  FACEBOOK_APP_SECRET: z.string().optional(),

  // ---------- Browser ----------
  BROWSER_HEADLESS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  MAX_BROWSER_INSTANCES: z.coerce.number().int().positive().default(3),

  // ---------- Rate limits ----------
  MAX_ENTRIES_PER_HOUR: z.coerce.number().int().positive().default(30),
  MAX_ENTRIES_PER_DAY: z.coerce.number().int().positive().default(200),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    // eslint-disable-next-line no-console
    console.error(
      `\n[env] Invalid environment variables:\n${formatted}\n`,
    );
    throw new Error('Environment validation failed. See above for details.');
  }

  return result.data;
}

/**
 * Typed, validated environment variables.
 * Importing this module will eagerly parse process.env and throw
 * at startup if required variables are missing or malformed.
 */
export const env: Env = validateEnv();
