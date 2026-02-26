import { z } from 'zod';

// ---------------------------------------------------------------------------
// Settings Zod schemas for API boundary validation
// ---------------------------------------------------------------------------

const generalSettingsSchema = z.object({
  maxEntriesPerHour: z.number().int().positive().optional(),
  maxEntriesPerDay: z.number().int().positive().optional(),
  browserHeadless: z.boolean().optional(),
  maxBrowserInstances: z.number().int().min(1).max(10).optional(),
  screenshotOnSuccess: z.boolean().optional(),
  screenshotOnFailure: z.boolean().optional(),
});

const captchaSettingsSchema = z.object({
  provider: z.enum(['2captcha', 'anticaptcha', 'capsolver']).optional(),
  apiKey: z.string().min(1).optional(),
  maxTimeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
});

const proxySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  rotationIntervalMs: z.number().int().positive().optional(),
  healthCheckIntervalMs: z.number().int().positive().optional(),
  maxConsecutiveFailures: z.number().int().min(1).optional(),
});

const scheduleSettingsSchema = z.object({
  discoveryIntervalMs: z.number().int().positive().optional(),
  discoveryEnabled: z.boolean().optional(),
  entryScheduleEnabled: z.boolean().optional(),
  entryCronExpression: z.string().max(100).optional(),
  healthCheckIntervalMs: z.number().int().positive().optional(),
});

const notificationSettingsSchema = z.object({
  emailOnWin: z.boolean().optional(),
  emailOnError: z.boolean().optional(),
  emailRecipient: z.string().email().optional(),
});

/** Known general settings keys that can appear at the top level for convenience. */
const GENERAL_KEYS = new Set([
  'maxEntriesPerHour',
  'maxEntriesPerDay',
  'browserHeadless',
  'maxBrowserInstances',
  'screenshotOnSuccess',
  'screenshotOnFailure',
]);

const CATEGORY_KEYS = new Set(['general', 'captcha', 'proxy', 'schedule', 'notifications']);

/**
 * Accepts both nested `{ general: { maxEntriesPerHour: 50 } }` and
 * flat `{ maxEntriesPerHour: 50 }` formats for convenience. Flat keys
 * matching known general settings are promoted into `general`.
 */
export const updateSettingsSchema = z
  .object({
    general: generalSettingsSchema.optional(),
    captcha: captchaSettingsSchema.optional(),
    proxy: proxySettingsSchema.optional(),
    schedule: scheduleSettingsSchema.optional(),
    notifications: notificationSettingsSchema.optional(),
  })
  .passthrough()
  .transform((data) => {
    // Promote flat top-level general settings keys into general
    const flat: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!CATEGORY_KEYS.has(key) && GENERAL_KEYS.has(key)) {
        flat[key] = value;
      }
    }
    if (Object.keys(flat).length > 0) {
      const existing = (data.general ?? {}) as Record<string, unknown>;
      (data as Record<string, unknown>)['general'] = { ...existing, ...flat };
      // Remove promoted keys from top level
      for (const key of Object.keys(flat)) {
        delete (data as Record<string, unknown>)[key];
      }
    }
    return data as {
      general?: z.infer<typeof generalSettingsSchema>;
      captcha?: z.infer<typeof captchaSettingsSchema>;
      proxy?: z.infer<typeof proxySettingsSchema>;
      schedule?: z.infer<typeof scheduleSettingsSchema>;
      notifications?: z.infer<typeof notificationSettingsSchema>;
    };
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
