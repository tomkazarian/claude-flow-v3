import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { getLogger } from '../../shared/logger.js';
import { validateBody } from '../middleware/validator.js';
import { updateSettingsSchema, type UpdateSettingsInput } from '../schemas/settings.schema.js';

const logger = getLogger('server', { component: 'settings' });

/** Default settings structure used when no settings exist yet. */
const DEFAULT_SETTINGS: Record<string, Record<string, unknown>> = {
  general: {
    maxEntriesPerHour: 30,
    maxEntriesPerDay: 200,
    browserHeadless: true,
    maxBrowserInstances: 3,
    screenshotOnSuccess: false,
    screenshotOnFailure: true,
  },
  captcha: {
    provider: '2captcha',
    maxTimeoutMs: 120000,
    maxRetries: 2,
  },
  proxy: {
    enabled: false,
    rotationIntervalMs: 300000,
    healthCheckIntervalMs: 600000,
    maxConsecutiveFailures: 3,
  },
  schedule: {
    discoveryIntervalMs: 3600000,
    discoveryEnabled: true,
    entryScheduleEnabled: true,
    entryCronExpression: '*/5 * * * *',
    healthCheckIntervalMs: 300000,
  },
  notifications: {
    emailOnWin: true,
    emailOnError: false,
  },
};

/**
 * Reads a single setting category from the database.
 */
async function getSettingValue(key: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .limit(1);

  if (rows.length === 0) {
    return (DEFAULT_SETTINGS[key] as Record<string, unknown>) ?? {};
  }

  try {
    return JSON.parse(rows[0]!.value) as Record<string, unknown>;
  } catch {
    return (DEFAULT_SETTINGS[key] as Record<string, unknown>) ?? {};
  }
}

/**
 * Writes a single setting category to the database (upsert).
 */
async function setSettingValue(key: string, value: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const jsonValue = JSON.stringify(value);

  const existing = await db
    .select({ key: schema.appSettings.key })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.appSettings)
      .set({ value: jsonValue, updatedAt: now })
      .where(eq(schema.appSettings.key, key));
  } else {
    await db.insert(schema.appSettings).values({
      key,
      value: jsonValue,
      updatedAt: now,
    });
  }
}

// ---------------------------------------------------------------------------
// Zod schemas for individual settings sub-routes
// ---------------------------------------------------------------------------

const captchaSettingsSchema = z.object({
  provider: z.enum(['2captcha', 'anticaptcha', 'capsolver']).optional(),
  apiKey: z.string().optional(),
  timeout: z.number().positive().optional(),
  maxRetries: z.number().int().positive().optional(),
}).passthrough();

const scheduleSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(0).max(23).optional(),
  maxEntriesPerDay: z.number().int().positive().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
}).passthrough();

const proxySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  rotationStrategy: z.enum(['round-robin', 'random', 'least-used', 'geo-matched', 'sticky']).optional(),
  healthCheckInterval: z.number().positive().optional(),
}).passthrough();

/**
 * App settings routes.
 */
export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET / - Get all settings grouped by category
  app.get('/', async (_request, reply: FastifyReply) => {
    const categories = ['general', 'captcha', 'proxy', 'schedule', 'notifications'];

    const settings: Record<string, Record<string, unknown>> = {};
    for (const category of categories) {
      settings[category] = await getSettingValue(category);
    }

    return reply.send({ data: settings });
  });

  // PUT / - Update settings (partial update across categories)
  app.put(
    '/',
    { preHandler: [validateBody(updateSettingsSchema)] },
    async (request, reply: FastifyReply) => {
      const body = request.body as UpdateSettingsInput;

      const categories = ['general', 'captcha', 'proxy', 'schedule', 'notifications'] as const;

      for (const category of categories) {
        const updates = body[category];
        if (updates && Object.keys(updates).length > 0) {
          const current = await getSettingValue(category);
          const merged = { ...current, ...updates };
          await setSettingValue(category, merged);
        }
      }

      // Read back all settings
      const settings: Record<string, Record<string, unknown>> = {};
      for (const category of categories) {
        settings[category] = await getSettingValue(category);
      }

      logger.info('Settings updated');

      return reply.send({ data: settings });
    },
  );

  // GET /captcha - CAPTCHA provider config
  app.get('/captcha', async (_request, reply: FastifyReply) => {
    const captchaSettings = await getSettingValue('captcha');

    return reply.send({
      data: {
        provider: captchaSettings['provider'] ?? '2captcha',
        status: captchaSettings['apiKey'] ? 'configured' : 'not_configured',
        maxTimeoutMs: captchaSettings['maxTimeoutMs'] ?? 120000,
        maxRetries: captchaSettings['maxRetries'] ?? 2,
        balance: null, // Would need to call provider API for real balance
      },
    });
  });

  // PUT /captcha - Update CAPTCHA config
  app.put(
    '/captcha',
    { preHandler: [validateBody(captchaSettingsSchema)] },
    async (request, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;
    const current = await getSettingValue('captcha');
    const merged = { ...current, ...body };
    await setSettingValue('captcha', merged);

    logger.info('CAPTCHA settings updated');

    return reply.send({ data: merged });
  },
  );

  // GET /schedule - Scheduling config
  app.get('/schedule', async (_request, reply: FastifyReply) => {
    const scheduleSettings = await getSettingValue('schedule');
    return reply.send({ data: scheduleSettings });
  });

  // PUT /schedule - Update scheduling config
  app.put(
    '/schedule',
    { preHandler: [validateBody(scheduleSettingsSchema)] },
    async (request, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;
    const current = await getSettingValue('schedule');
    const merged = { ...current, ...body };
    await setSettingValue('schedule', merged);

    logger.info('Schedule settings updated');

    return reply.send({ data: merged });
  },
  );

  // GET /proxy - Proxy configuration
  app.get('/proxy', async (_request, reply: FastifyReply) => {
    const proxySettings = await getSettingValue('proxy');
    return reply.send({ data: proxySettings });
  });

  // PUT /proxy - Update proxy config
  app.put(
    '/proxy',
    { preHandler: [validateBody(proxySettingsSchema)] },
    async (request, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;
    const current = await getSettingValue('proxy');
    const merged = { ...current, ...body };
    await setSettingValue('proxy', merged);

    logger.info('Proxy settings updated');

    return reply.send({ data: merged });
  },
  );
}
