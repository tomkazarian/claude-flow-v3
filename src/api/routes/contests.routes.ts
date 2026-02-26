import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, desc, asc, like, sql, and, inArray, gte, count as countFn } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { generateId } from '../../shared/crypto.js';
import { normalizeUrl } from '../../shared/utils.js';
import { hashForDedup } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';
import { getLogger } from '../../shared/logger.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validator.js';
import { idParamSchema, paginatedResponse } from '../schemas/common.schema.js';
import {
  createContestSchema,
  updateContestSchema,
  contestFilterSchema,
  bulkEnterSchema,
  discoverUrlSchema,
  enterContestSchema,
  type ContestFilterInput,
  type CreateContestInput,
  type UpdateContestInput,
  type BulkEnterInput,
  type EnterContestInput,
} from '../schemas/contest.schema.js';

const logger = getLogger('server', { component: 'contests' });

/**
 * Contest CRUD and management routes.
 */
export async function contestRoutes(app: FastifyInstance): Promise<void> {
  // GET / - List contests with pagination, filtering, sorting
  app.get(
    '/',
    { preHandler: [validateQuery(contestFilterSchema as any)] },
    async (request, reply: FastifyReply) => {
      const { page, limit, status, type, source, search, minPriority, sortBy, sortOrder } =
        request.query as ContestFilterInput;
      const db = getDb();
      const offset = (page - 1) * limit;

      const conditions: ReturnType<typeof eq>[] = [];

      if (status) {
        const statuses = Array.isArray(status) ? status : [status];
        conditions.push(
          inArray(schema.contests.status, statuses as any),
        );
      }

      if (type) {
        const types = Array.isArray(type) ? type : [type];
        conditions.push(
          inArray(schema.contests.type, types as any),
        );
      }

      if (source) {
        conditions.push(eq(schema.contests.source, source));
      }

      if (search) {
        conditions.push(like(schema.contests.title, `%${search}%`));
      }

      if (minPriority !== undefined) {
        conditions.push(gte(schema.contests.priorityScore, minPriority));
      }

      // Exclude soft-deleted contests
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Determine sort column
      let orderByClause;
      const direction = sortOrder === 'asc' ? asc : desc;
      switch (sortBy) {
        case 'priority_score':
          orderByClause = direction(schema.contests.priorityScore);
          break;
        case 'end_date':
          orderByClause = direction(schema.contests.endDate);
          break;
        case 'created_at':
          orderByClause = direction(schema.contests.createdAt);
          break;
        default:
          orderByClause = desc(schema.contests.createdAt);
      }

      const [contestRows, totalResult] = await Promise.all([
        db
          .select()
          .from(schema.contests)
          .where(whereClause)
          .orderBy(orderByClause)
          .limit(limit)
          .offset(offset),
        db
          .select({ count: countFn() })
          .from(schema.contests)
          .where(whereClause),
      ]);

      const total = totalResult[0]?.count ?? 0;

      return reply.send(paginatedResponse(contestRows, total, page, limit));
    },
  );

  // GET /:id - Get contest by ID with entry stats
  app.get(
    '/:id',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const contest = await db
        .select()
        .from(schema.contests)
        .where(eq(schema.contests.id, id))
        .limit(1);

      if (contest.length === 0) {
        throw new AppError('Contest not found', 'CONTEST_NOT_FOUND', 404);
      }

      // Fetch entry stats
      const entryStats = await db
        .select({
          total: countFn(),
          successful: sql<number>`SUM(CASE WHEN ${schema.entries.status} IN ('submitted', 'confirmed', 'won') THEN 1 ELSE 0 END)`,
          failed: sql<number>`SUM(CASE WHEN ${schema.entries.status} = 'failed' THEN 1 ELSE 0 END)`,
        })
        .from(schema.entries)
        .where(eq(schema.entries.contestId, id));

      const stats = entryStats[0];
      const totalEntries = stats?.total ?? 0;
      const successfulEntries = Number(stats?.successful ?? 0);
      const successRate = totalEntries > 0 ? successfulEntries / totalEntries : 0;

      return reply.send({
        data: {
          ...contest[0],
          entryStats: {
            totalEntries,
            successfulEntries,
            failedEntries: Number(stats?.failed ?? 0),
            successRate: Math.round(successRate * 10000) / 100,
          },
        },
      });
    },
  );

  // POST / - Manually add a contest
  app.post(
    '/',
    { preHandler: [validateBody(createContestSchema)] },
    async (request, reply: FastifyReply) => {
      const body = request.body as CreateContestInput;
      const db = getDb();

      const normalizedUrl = normalizeUrl(body.url);
      const externalId = hashForDedup(normalizedUrl);

      // Check for duplicate URL
      const existing = await db
        .select({ id: schema.contests.id })
        .from(schema.contests)
        .where(eq(schema.contests.externalId, externalId))
        .limit(1);

      if (existing.length > 0) {
        throw new AppError(
          `Contest with URL already exists: ${existing[0]!.id}`,
          'CONTEST_DUPLICATE',
          409,
        );
      }

      const id = generateId();
      const now = new Date().toISOString();

      await db.insert(schema.contests).values({
        id,
        externalId,
        url: normalizedUrl,
        title: body.title ?? normalizedUrl,
        type: body.type ?? 'sweepstakes',
        entryMethod: body.entryMethod ?? 'form',
        status: 'discovered',
        sponsor: body.sponsor ?? null,
        description: body.description ?? null,
        source: body.source ?? 'manual',
        sourceUrl: body.sourceUrl ?? null,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        entryFrequency: body.entryFrequency ?? 'once',
        maxEntries: body.maxEntries ?? null,
        prizeDescription: body.prizeDescription ?? null,
        prizeValue: body.prizeValue ?? null,
        prizeCategory: body.prizeCategory ?? null,
        ageRequirement: body.ageRequirement ?? 18,
        geoRestrictions: JSON.stringify(body.geoRestrictions ?? {}),
        requiresCaptcha: body.requiresCaptcha ? 1 : 0,
        requiresEmailConfirm: body.requiresEmailConfirm ? 1 : 0,
        requiresSmsVerify: body.requiresSmsVerify ? 1 : 0,
        requiresSocialAction: body.requiresSocialAction ? 1 : 0,
        socialActions: JSON.stringify(body.socialActions ?? []),
        termsUrl: body.termsUrl ?? null,
        formMapping: JSON.stringify(body.formMapping ?? {}),
        metadata: JSON.stringify(body.metadata ?? {}),
        createdAt: now,
        updatedAt: now,
      });

      const created = await db
        .select()
        .from(schema.contests)
        .where(eq(schema.contests.id, id))
        .limit(1);

      logger.info({ contestId: id, url: normalizedUrl }, 'Contest created');

      return reply.status(201).send({ data: created[0] });
    },
  );

  // PATCH /:id - Update contest
  app.patch(
    '/:id',
    { preHandler: [validateParams(idParamSchema), validateBody(updateContestSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as UpdateContestInput;
      const db = getDb();

      const existing = await db
        .select({ id: schema.contests.id })
        .from(schema.contests)
        .where(eq(schema.contests.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new AppError('Contest not found', 'CONTEST_NOT_FOUND', 404);
      }

      const updateValues: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      if (body.title !== undefined) updateValues['title'] = body.title;
      if (body.sponsor !== undefined) updateValues['sponsor'] = body.sponsor;
      if (body.description !== undefined) updateValues['description'] = body.description;
      if (body.status !== undefined) updateValues['status'] = body.status;
      if (body.type !== undefined) updateValues['type'] = body.type;
      if (body.entryMethod !== undefined) updateValues['entryMethod'] = body.entryMethod;
      if (body.startDate !== undefined) updateValues['startDate'] = body.startDate;
      if (body.endDate !== undefined) updateValues['endDate'] = body.endDate;
      if (body.entryFrequency !== undefined) updateValues['entryFrequency'] = body.entryFrequency;
      if (body.maxEntries !== undefined) updateValues['maxEntries'] = body.maxEntries;
      if (body.prizeDescription !== undefined) updateValues['prizeDescription'] = body.prizeDescription;
      if (body.prizeValue !== undefined) updateValues['prizeValue'] = body.prizeValue;
      if (body.prizeCategory !== undefined) updateValues['prizeCategory'] = body.prizeCategory;
      if (body.difficultyScore !== undefined) updateValues['difficultyScore'] = body.difficultyScore;
      if (body.legitimacyScore !== undefined) updateValues['legitimacyScore'] = body.legitimacyScore;
      if (body.priorityScore !== undefined) updateValues['priorityScore'] = body.priorityScore;
      if (body.formMapping !== undefined) updateValues['formMapping'] = JSON.stringify(body.formMapping);
      if (body.metadata !== undefined) updateValues['metadata'] = JSON.stringify(body.metadata);

      await db
        .update(schema.contests)
        .set(updateValues)
        .where(eq(schema.contests.id, id));

      const updated = await db
        .select()
        .from(schema.contests)
        .where(eq(schema.contests.id, id))
        .limit(1);

      logger.info({ contestId: id }, 'Contest updated');

      return reply.send({ data: updated[0] });
    },
  );

  // DELETE /:id - Soft delete (set status to 'invalid')
  app.delete(
    '/:id',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const existing = await db
        .select({ id: schema.contests.id })
        .from(schema.contests)
        .where(eq(schema.contests.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new AppError('Contest not found', 'CONTEST_NOT_FOUND', 404);
      }

      await db
        .update(schema.contests)
        .set({
          status: 'invalid',
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.contests.id, id));

      logger.info({ contestId: id }, 'Contest soft-deleted');

      return reply.status(204).send();
    },
  );

  // POST /:id/enter - Trigger immediate entry
  app.post(
    '/:id/enter',
    { preHandler: [validateParams(idParamSchema), validateBody(enterContestSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { profileId } = request.body as EnterContestInput;
      const db = getDb();

      const contest = await db
        .select()
        .from(schema.contests)
        .where(eq(schema.contests.id, id))
        .limit(1);

      if (contest.length === 0) {
        throw new AppError('Contest not found', 'CONTEST_NOT_FOUND', 404);
      }

      // Verify profile exists
      const profile = await db
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, profileId))
        .limit(1);

      if (profile.length === 0) {
        throw new AppError('Profile not found', 'PROFILE_NOT_FOUND', 404);
      }

      // Create pending entry
      const entryId = generateId();
      const now = new Date().toISOString();

      await db.insert(schema.entries).values({
        id: entryId,
        contestId: id,
        profileId,
        status: 'pending',
        attemptNumber: 1,
        createdAt: now,
        updatedAt: now,
      });

      logger.info({ contestId: id, profileId, entryId }, 'Entry queued for contest');

      return reply.status(202).send({
        data: {
          entryId,
          contestId: id,
          profileId,
          status: 'pending',
          message: 'Entry has been queued for processing',
        },
      });
    },
  );

  // POST /:id/requeue - Re-queue a failed entry
  app.post(
    '/:id/requeue',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      // Find the latest failed entry for this contest
      const failedEntries = await db
        .select()
        .from(schema.entries)
        .where(and(eq(schema.entries.contestId, id), eq(schema.entries.status, 'failed')))
        .orderBy(desc(schema.entries.createdAt))
        .limit(1);

      if (failedEntries.length === 0) {
        throw new AppError(
          'No failed entries found for this contest',
          'NO_FAILED_ENTRIES',
          404,
        );
      }

      const failedEntry = failedEntries[0]!;

      // Create a new entry as a retry
      const entryId = generateId();
      const now = new Date().toISOString();

      await db.insert(schema.entries).values({
        id: entryId,
        contestId: id,
        profileId: failedEntry.profileId,
        status: 'pending',
        attemptNumber: failedEntry.attemptNumber + 1,
        createdAt: now,
        updatedAt: now,
      });

      logger.info(
        { contestId: id, entryId, previousEntryId: failedEntry.id },
        'Failed entry re-queued',
      );

      return reply.status(202).send({
        data: {
          entryId,
          contestId: id,
          profileId: failedEntry.profileId,
          attemptNumber: failedEntry.attemptNumber + 1,
          status: 'pending',
          message: 'Failed entry has been re-queued',
        },
      });
    },
  );

  // GET /:id/entries - Get all entries for a contest
  app.get(
    '/:id/entries',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const contest = await db
        .select({ id: schema.contests.id })
        .from(schema.contests)
        .where(eq(schema.contests.id, id))
        .limit(1);

      if (contest.length === 0) {
        throw new AppError('Contest not found', 'CONTEST_NOT_FOUND', 404);
      }

      const entryRows = await db
        .select()
        .from(schema.entries)
        .where(eq(schema.entries.contestId, id))
        .orderBy(desc(schema.entries.createdAt));

      return reply.send({ data: entryRows });
    },
  );

  // POST /bulk-enter - Queue multiple contests for entry
  app.post(
    '/bulk-enter',
    { preHandler: [validateBody(bulkEnterSchema)] },
    async (request, reply: FastifyReply) => {
      const { contestIds, profileId } = request.body as BulkEnterInput;
      const db = getDb();

      // Verify profile exists
      const profile = await db
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, profileId))
        .limit(1);

      if (profile.length === 0) {
        throw new AppError('Profile not found', 'PROFILE_NOT_FOUND', 404);
      }

      // Verify all contests exist
      const existingContests = await db
        .select({ id: schema.contests.id })
        .from(schema.contests)
        .where(inArray(schema.contests.id, contestIds));

      const existingIds = new Set(existingContests.map((c) => c.id));
      const missingIds = contestIds.filter((cid) => !existingIds.has(cid));

      if (missingIds.length > 0) {
        throw new AppError(
          `Contests not found: ${missingIds.join(', ')}`,
          'CONTESTS_NOT_FOUND',
          404,
        );
      }

      const now = new Date().toISOString();
      const results: Array<{ entryId: string; contestId: string }> = [];

      for (const contestId of contestIds) {
        const entryId = generateId();
        await db.insert(schema.entries).values({
          id: entryId,
          contestId,
          profileId,
          status: 'pending',
          attemptNumber: 1,
          createdAt: now,
          updatedAt: now,
        });
        results.push({ entryId, contestId });
      }

      logger.info(
        { profileId, contestCount: contestIds.length },
        'Bulk entries queued',
      );

      return reply.status(202).send({
        data: {
          queued: results.length,
          entries: results,
          message: `${results.length} entries have been queued for processing`,
        },
      });
    },
  );

  // POST /discover - Trigger manual contest discovery from URL
  app.post(
    '/discover',
    { preHandler: [validateBody(discoverUrlSchema)] },
    async (request, reply: FastifyReply) => {
      const { url } = request.body as { url: string };

      logger.info({ url }, 'Manual discovery triggered');

      // In a full implementation this would trigger a discovery job.
      // For now, create a discovered contest stub.
      const db = getDb();
      const normalizedUrl = normalizeUrl(url);
      const externalId = hashForDedup(normalizedUrl);

      // Check if already exists
      const existing = await db
        .select({ id: schema.contests.id })
        .from(schema.contests)
        .where(eq(schema.contests.externalId, externalId))
        .limit(1);

      if (existing.length > 0) {
        return reply.send({
          data: {
            contestId: existing[0]!.id,
            status: 'already_exists',
            message: 'Contest with this URL already exists',
          },
        });
      }

      const id = generateId();
      const now = new Date().toISOString();

      await db.insert(schema.contests).values({
        id,
        externalId,
        url: normalizedUrl,
        title: normalizedUrl,
        type: 'sweepstakes',
        entryMethod: 'form',
        status: 'discovered',
        source: 'manual_discovery',
        createdAt: now,
        updatedAt: now,
      });

      return reply.status(202).send({
        data: {
          contestId: id,
          status: 'discovery_started',
          message: 'Contest discovery has been triggered. Contest details will be enriched asynchronously.',
        },
      });
    },
  );
}
