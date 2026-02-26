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

export const updateSettingsSchema = z.object({
  general: generalSettingsSchema.optional(),
  captcha: captchaSettingsSchema.optional(),
  proxy: proxySettingsSchema.optional(),
  schedule: scheduleSettingsSchema.optional(),
  notifications: notificationSettingsSchema.optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
