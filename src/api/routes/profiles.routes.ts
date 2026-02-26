import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, desc, sql, count as countFn } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { generateId, encrypt, decrypt } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';
import { getLogger } from '../../shared/logger.js';
import { validateBody, validateParams } from '../middleware/validator.js';
import { idParamSchema } from '../schemas/common.schema.js';
import {
  createProfileSchema,
  updateProfileSchema,
  type CreateProfileInput,
  type UpdateProfileInput,
} from '../schemas/profile.schema.js';

const logger = getLogger('server', { component: 'profiles' });

/** Fields considered PII that should be encrypted at rest. */
const PII_FIELDS = ['email', 'phone', 'addressLine1', 'addressLine2'] as const;

/**
 * Decrypts PII fields on a profile row for API output.
 */
function decryptProfile(row: Record<string, unknown>): Record<string, unknown> {
  const result = { ...row };
  for (const field of PII_FIELDS) {
    const value = result[field];
    if (typeof value === 'string' && value.includes(':')) {
      try {
        result[field] = decrypt(value);
      } catch {
        // If decryption fails, the value may not be encrypted (e.g., legacy data)
      }
    }
  }
  return result;
}

/**
 * Encrypts PII fields for storage.
 */
function encryptPiiFields(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };
  for (const field of PII_FIELDS) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) {
      result[field] = encrypt(value);
    }
  }
  return result;
}

/**
 * Profile CRUD routes.
 */
export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // GET / - List all profiles
  app.get('/', async (_request, reply: FastifyReply) => {
    const db = getDb();

    const profileRows = await db
      .select()
      .from(schema.profiles)
      .orderBy(desc(schema.profiles.createdAt));

    // Decrypt PII for the response
    const decrypted = profileRows.map((row) => decryptProfile(row as Record<string, unknown>));

    return reply.send({ data: decrypted });
  });

  // GET /:id - Get profile with decrypted PII
  app.get(
    '/:id',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const rows = await db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id))
        .limit(1);

      if (rows.length === 0) {
        throw new AppError('Profile not found', 'PROFILE_NOT_FOUND', 404);
      }

      const decrypted = decryptProfile(rows[0] as Record<string, unknown>);

      return reply.send({ data: decrypted });
    },
  );

  // POST / - Create profile with PII encryption
  app.post(
    '/',
    { preHandler: [validateBody(createProfileSchema)] },
    async (request, reply: FastifyReply) => {
      const body = request.body as CreateProfileInput;
      const db = getDb();

      const id = generateId();
      const now = new Date().toISOString();

      // Encrypt PII fields
      const encrypted = encryptPiiFields(body as Record<string, unknown>);

      await db.insert(schema.profiles).values({
        id,
        firstName: body.firstName,
        lastName: body.lastName,
        email: encrypted['email'] as string,
        emailAliases: JSON.stringify(body.emailAliases ?? []),
        phone: (encrypted['phone'] as string) ?? null,
        phoneProvider: body.phoneProvider ?? null,
        addressLine1: (encrypted['addressLine1'] as string) ?? null,
        addressLine2: (encrypted['addressLine2'] as string) ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        zip: body.zip ?? null,
        country: body.country ?? 'US',
        dateOfBirth: body.dateOfBirth ?? null,
        gender: body.gender ?? null,
        socialAccounts: JSON.stringify(body.socialAccounts ?? {}),
        isActive: 1,
        createdAt: now,
        updatedAt: now,
      });

      const created = await db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id))
        .limit(1);

      const decrypted = decryptProfile(created[0] as Record<string, unknown>);

      logger.info({ profileId: id }, 'Profile created');

      return reply.status(201).send({ data: decrypted });
    },
  );

  // PUT /:id - Full update
  app.put(
    '/:id',
    { preHandler: [validateParams(idParamSchema), validateBody(createProfileSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as CreateProfileInput;
      const db = getDb();

      const existing = await db
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new AppError('Profile not found', 'PROFILE_NOT_FOUND', 404);
      }

      const encrypted = encryptPiiFields(body as Record<string, unknown>);
      const now = new Date().toISOString();

      await db
        .update(schema.profiles)
        .set({
          firstName: body.firstName,
          lastName: body.lastName,
          email: encrypted['email'] as string,
          emailAliases: JSON.stringify(body.emailAliases ?? []),
          phone: (encrypted['phone'] as string) ?? null,
          phoneProvider: body.phoneProvider ?? null,
          addressLine1: (encrypted['addressLine1'] as string) ?? null,
          addressLine2: (encrypted['addressLine2'] as string) ?? null,
          city: body.city ?? null,
          state: body.state ?? null,
          zip: body.zip ?? null,
          country: body.country ?? 'US',
          dateOfBirth: body.dateOfBirth ?? null,
          gender: body.gender ?? null,
          socialAccounts: JSON.stringify(body.socialAccounts ?? {}),
          updatedAt: now,
        })
        .where(eq(schema.profiles.id, id));

      const updated = await db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id))
        .limit(1);

      const decrypted = decryptProfile(updated[0] as Record<string, unknown>);

      logger.info({ profileId: id }, 'Profile fully updated');

      return reply.send({ data: decrypted });
    },
  );

  // PATCH /:id - Partial update
  app.patch(
    '/:id',
    { preHandler: [validateParams(idParamSchema), validateBody(updateProfileSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as UpdateProfileInput;
      const db = getDb();

      const existing = await db
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new AppError('Profile not found', 'PROFILE_NOT_FOUND', 404);
      }

      const updateValues: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      // Encrypt PII fields if they are being updated
      const encrypted = encryptPiiFields(body as Record<string, unknown>);

      if (body.firstName !== undefined) updateValues['firstName'] = body.firstName;
      if (body.lastName !== undefined) updateValues['lastName'] = body.lastName;
      if (body.email !== undefined) updateValues['email'] = encrypted['email'];
      if (body.emailAliases !== undefined) updateValues['emailAliases'] = JSON.stringify(body.emailAliases);
      if (body.phone !== undefined) updateValues['phone'] = encrypted['phone'];
      if (body.phoneProvider !== undefined) updateValues['phoneProvider'] = body.phoneProvider;
      if (body.addressLine1 !== undefined) updateValues['addressLine1'] = encrypted['addressLine1'];
      if (body.addressLine2 !== undefined) updateValues['addressLine2'] = encrypted['addressLine2'];
      if (body.city !== undefined) updateValues['city'] = body.city;
      if (body.state !== undefined) updateValues['state'] = body.state;
      if (body.zip !== undefined) updateValues['zip'] = body.zip;
      if (body.country !== undefined) updateValues['country'] = body.country;
      if (body.dateOfBirth !== undefined) updateValues['dateOfBirth'] = body.dateOfBirth;
      if (body.gender !== undefined) updateValues['gender'] = body.gender;
      if (body.socialAccounts !== undefined) updateValues['socialAccounts'] = JSON.stringify(body.socialAccounts);
      if (body.isActive !== undefined) updateValues['isActive'] = body.isActive ? 1 : 0;

      await db
        .update(schema.profiles)
        .set(updateValues)
        .where(eq(schema.profiles.id, id));

      const updated = await db
        .select()
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id))
        .limit(1);

      const decrypted = decryptProfile(updated[0] as Record<string, unknown>);

      logger.info({ profileId: id }, 'Profile partially updated');

      return reply.send({ data: decrypted });
    },
  );

  // DELETE /:id - Deactivate profile
  app.delete(
    '/:id',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const existing = await db
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new AppError('Profile not found', 'PROFILE_NOT_FOUND', 404);
      }

      await db
        .update(schema.profiles)
        .set({
          isActive: 0,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.profiles.id, id));

      logger.info({ profileId: id }, 'Profile deactivated');

      return reply.status(204).send();
    },
  );

  // GET /:id/entries - Entries for a profile
  app.get(
    '/:id/entries',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const profile = await db
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id))
        .limit(1);

      if (profile.length === 0) {
        throw new AppError('Profile not found', 'PROFILE_NOT_FOUND', 404);
      }

      const entryRows = await db
        .select()
        .from(schema.entries)
        .where(eq(schema.entries.profileId, id))
        .orderBy(desc(schema.entries.createdAt));

      return reply.send({ data: entryRows });
    },
  );

  // GET /:id/wins - Wins for a profile
  app.get(
    '/:id/wins',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const profile = await db
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id))
        .limit(1);

      if (profile.length === 0) {
        throw new AppError('Profile not found', 'PROFILE_NOT_FOUND', 404);
      }

      const winRows = await db
        .select({
          win: schema.wins,
          contest: {
            title: schema.contests.title,
            url: schema.contests.url,
            type: schema.contests.type,
          },
        })
        .from(schema.wins)
        .leftJoin(schema.contests, eq(schema.wins.contestId, schema.contests.id))
        .where(eq(schema.wins.profileId, id))
        .orderBy(desc(schema.wins.createdAt));

      const results = winRows.map((row) => ({
        ...row.win,
        contest: row.contest,
      }));

      return reply.send({ data: results });
    },
  );

  // GET /:id/stats - Profile statistics
  app.get(
    '/:id/stats',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const profile = await db
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, id))
        .limit(1);

      if (profile.length === 0) {
        throw new AppError('Profile not found', 'PROFILE_NOT_FOUND', 404);
      }

      const [entryStats, winStats] = await Promise.all([
        db
          .select({
            total: countFn(),
            successful: sql<number>`SUM(CASE WHEN ${schema.entries.status} IN ('submitted', 'confirmed', 'won') THEN 1 ELSE 0 END)`,
            failed: sql<number>`SUM(CASE WHEN ${schema.entries.status} = 'failed' THEN 1 ELSE 0 END)`,
          })
          .from(schema.entries)
          .where(eq(schema.entries.profileId, id)),
        db
          .select({
            totalWins: countFn(),
            totalPrizeValue: sql<number>`COALESCE(SUM(${schema.wins.prizeValue}), 0)`,
          })
          .from(schema.wins)
          .where(eq(schema.wins.profileId, id)),
      ]);

      const totalEntries = entryStats[0]?.total ?? 0;
      const successfulEntries = Number(entryStats[0]?.successful ?? 0);
      const successRate = totalEntries > 0 ? Math.round((successfulEntries / totalEntries) * 10000) / 100 : 0;

      return reply.send({
        data: {
          profileId: id,
          totalEntries,
          successfulEntries,
          failedEntries: Number(entryStats[0]?.failed ?? 0),
          successRate,
          totalWins: winStats[0]?.totalWins ?? 0,
          totalPrizeValue: Number(winStats[0]?.totalPrizeValue ?? 0),
        },
      });
    },
  );
}
