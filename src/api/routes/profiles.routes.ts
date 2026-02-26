import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, desc, sql, count as countFn } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { encrypt, generateId } from '../../shared/crypto.js';
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

// NOTE: PII encryption/decryption was previously duplicated here, encrypting
// email and phone in addition to the address fields that ProfileManager
// encrypts. This caused data corruption: the same field could be encrypted
// once (via ProfileManager) or twice (via routes + ProfileManager), making
// decryption inconsistent. ProfileManager is now the single source of truth
// for PII encryption (it encrypts only addressLine1 and addressLine2).
// The routes layer passes data through without additional encryption.

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

    return reply.send({ data: profileRows });
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

      return reply.send({ data: rows[0] });
    },
  );

  // POST / - Create profile (PII encryption handled by ProfileManager)
  app.post(
    '/',
    { preHandler: [validateBody(createProfileSchema)] },
    async (request, reply: FastifyReply) => {
      const body = request.body as CreateProfileInput;
      const db = getDb();

      const id = generateId();
      const now = new Date().toISOString();

      // Encrypt PII address fields at rest, matching ProfileManager behavior.
      // addressLine1/addressLine2 contain physical addresses and must be
      // encrypted with AES-256-GCM before storage.
      await db.insert(schema.profiles).values({
        id,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        emailAliases: JSON.stringify(body.emailAliases ?? []),
        phone: body.phone ?? null,
        phoneProvider: body.phoneProvider ?? null,
        addressLine1: body.addressLine1 ? encrypt(body.addressLine1) : null,
        addressLine2: body.addressLine2 ? encrypt(body.addressLine2) : null,
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

      logger.info({ profileId: id }, 'Profile created');

      return reply.status(201).send({ data: created[0] });
    },
  );

  // PUT /:id - Full update (accepts partial body for convenience)
  app.put(
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

      const now = new Date().toISOString();

      // Only update fields that were explicitly provided.
      // Encrypt PII address fields to match ProfileManager behavior.
      const updateValues: Record<string, unknown> = { updatedAt: now };
      if (body.firstName !== undefined) updateValues['firstName'] = body.firstName;
      if (body.lastName !== undefined) updateValues['lastName'] = body.lastName;
      if (body.email !== undefined) updateValues['email'] = body.email;
      if (body.emailAliases !== undefined) updateValues['emailAliases'] = JSON.stringify(body.emailAliases);
      if (body.phone !== undefined) updateValues['phone'] = body.phone;
      if (body.phoneProvider !== undefined) updateValues['phoneProvider'] = body.phoneProvider;
      if (body.addressLine1 !== undefined) updateValues['addressLine1'] = body.addressLine1 ? encrypt(body.addressLine1) : null;
      if (body.addressLine2 !== undefined) updateValues['addressLine2'] = body.addressLine2 ? encrypt(body.addressLine2) : null;
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

      logger.info({ profileId: id }, 'Profile updated');

      return reply.send({ data: updated[0] });
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

      // Encrypt PII address fields to match ProfileManager behavior.
      if (body.firstName !== undefined) updateValues['firstName'] = body.firstName;
      if (body.lastName !== undefined) updateValues['lastName'] = body.lastName;
      if (body.email !== undefined) updateValues['email'] = body.email;
      if (body.emailAliases !== undefined) updateValues['emailAliases'] = JSON.stringify(body.emailAliases);
      if (body.phone !== undefined) updateValues['phone'] = body.phone;
      if (body.phoneProvider !== undefined) updateValues['phoneProvider'] = body.phoneProvider;
      if (body.addressLine1 !== undefined) updateValues['addressLine1'] = body.addressLine1 ? encrypt(body.addressLine1) : null;
      if (body.addressLine2 !== undefined) updateValues['addressLine2'] = body.addressLine2 ? encrypt(body.addressLine2) : null;
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

      logger.info({ profileId: id }, 'Profile partially updated');

      return reply.send({ data: updated[0] });
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
