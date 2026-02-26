import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, desc, count as countFn } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { generateId } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';
import { getLogger } from '../../shared/logger.js';
import { QUEUE_NAMES } from '../../shared/constants.js';
import { getRedis } from '../../queue/redis.js';
import { validateBody, validateParams } from '../middleware/validator.js';
import { idParamSchema } from '../schemas/common.schema.js';

const logger = getLogger('server', { component: 'discovery' });

const runDiscoverySchema = z.object({
  sourceId: z.string().min(1).optional(),
});

const createSourceSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['crawler', 'rss', 'api', 'social']),
  url: z.string().url().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  schedule: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});

const updateSourceSchema = createSourceSchema.partial();

/**
 * Discovery management routes.
 */
export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  // POST /run - Trigger a discovery run
  app.post(
    '/run',
    async (request, reply: FastifyReply) => {
      // Body is optional for this endpoint - parse it if present
      const parsed = runDiscoverySchema.safeParse(request.body ?? {});
      const { sourceId } = parsed.success ? parsed.data : {} as { sourceId?: string };
      const db = getDb();
      const redis = getRedis();

      if (!redis) {
        throw new AppError('Redis not available — cannot queue discovery jobs', 'REDIS_UNAVAILABLE', 503);
      }

      const discoveryQueue = new Queue(QUEUE_NAMES.DISCOVERY, {
        connection: redis,
      });

      try {
        if (sourceId) {
          // Validate the source exists and queue a single job
          const sources = await db
            .select()
            .from(schema.discoverySources)
            .where(eq(schema.discoverySources.id, sourceId))
            .limit(1);

          if (sources.length === 0) {
            throw new AppError('Discovery source not found', 'SOURCE_NOT_FOUND', 404);
          }

          const source = sources[0]!;
          let sourceConfig: Record<string, unknown> = {};
          try {
            sourceConfig = source.config ? (JSON.parse(source.config) as Record<string, unknown>) : {};
          } catch { /* use empty config */ }

          const job = await discoveryQueue.add('discovery-job', {
            sourceId: source.id,
            sourceName: source.name,
            sourceUrl: source.url ?? '',
            sourceType: source.type,
            sourceConfig,
          });

          logger.info({ sourceId, jobId: job.id }, 'Manual discovery job queued for specific source');

          return reply.status(202).send({
            data: {
              status: 'queued',
              jobId: job.id,
              sourceId,
              sourceName: source.name,
              message: `Discovery job queued for source "${source.name}"`,
            },
          });
        }

        // Trigger discovery for all active sources
        const activeSources = await db
          .select()
          .from(schema.discoverySources)
          .where(eq(schema.discoverySources.isActive, 1));

        const jobIds: string[] = [];
        for (const source of activeSources) {
          let sourceConfig: Record<string, unknown> = {};
          try {
            sourceConfig = source.config ? (JSON.parse(source.config) as Record<string, unknown>) : {};
          } catch { /* use empty config */ }

          const job = await discoveryQueue.add('discovery-job', {
            sourceId: source.id,
            sourceName: source.name,
            sourceUrl: source.url ?? '',
            sourceType: source.type,
            sourceConfig,
          });
          if (job.id) jobIds.push(job.id);
        }

        logger.info({ sourceCount: activeSources.length, jobIds }, 'Manual discovery jobs queued for all active sources');

        return reply.status(202).send({
          data: {
            status: 'queued',
            jobsQueued: jobIds.length,
            jobIds,
            sources: activeSources.map((s) => ({ id: s.id, name: s.name })),
            message: `${jobIds.length} discovery job(s) queued for active sources`,
          },
        });
      } finally {
        await discoveryQueue.close();
      }
    },
  );

  // GET /sources - List configured discovery sources
  app.get('/sources', async (_request, reply: FastifyReply) => {
    const db = getDb();

    const sources = await db
      .select()
      .from(schema.discoverySources)
      .orderBy(desc(schema.discoverySources.createdAt));

    return reply.send({ data: sources });
  });

  // POST /sources - Add a new discovery source
  app.post(
    '/sources',
    { preHandler: [validateBody(createSourceSchema)] },
    async (request, reply: FastifyReply) => {
      const body = request.body as z.infer<typeof createSourceSchema>;
      const db = getDb();

      const id = generateId();
      const now = new Date().toISOString();

      await db.insert(schema.discoverySources).values({
        id,
        name: body.name,
        type: body.type,
        url: body.url ?? null,
        config: JSON.stringify(body.config ?? {}),
        schedule: body.schedule ?? null,
        isActive: body.isActive === false ? 0 : 1,
        contestsFound: 0,
        errorCount: 0,
        createdAt: now,
      });

      const created = await db
        .select()
        .from(schema.discoverySources)
        .where(eq(schema.discoverySources.id, id))
        .limit(1);

      logger.info({ sourceId: id, name: body.name }, 'Discovery source created');

      return reply.status(201).send({ data: created[0] });
    },
  );

  // PUT /sources/:id - Update a discovery source
  app.put(
    '/sources/:id',
    { preHandler: [validateParams(idParamSchema), validateBody(updateSourceSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof updateSourceSchema>;
      const db = getDb();

      const existing = await db
        .select({ id: schema.discoverySources.id })
        .from(schema.discoverySources)
        .where(eq(schema.discoverySources.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new AppError('Discovery source not found', 'SOURCE_NOT_FOUND', 404);
      }

      const updateValues: Record<string, unknown> = {};

      if (body.name !== undefined) updateValues['name'] = body.name;
      if (body.type !== undefined) updateValues['type'] = body.type;
      if (body.url !== undefined) updateValues['url'] = body.url;
      if (body.config !== undefined) updateValues['config'] = JSON.stringify(body.config);
      if (body.schedule !== undefined) updateValues['schedule'] = body.schedule;
      if (body.isActive !== undefined) updateValues['isActive'] = body.isActive ? 1 : 0;

      await db
        .update(schema.discoverySources)
        .set(updateValues)
        .where(eq(schema.discoverySources.id, id));

      const updated = await db
        .select()
        .from(schema.discoverySources)
        .where(eq(schema.discoverySources.id, id))
        .limit(1);

      logger.info({ sourceId: id }, 'Discovery source updated');

      return reply.send({ data: updated[0] });
    },
  );

  // DELETE /sources/:id - Delete a discovery source
  app.delete(
    '/sources/:id',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const existing = await db
        .select({ id: schema.discoverySources.id })
        .from(schema.discoverySources)
        .where(eq(schema.discoverySources.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new AppError('Discovery source not found', 'SOURCE_NOT_FOUND', 404);
      }

      await db.delete(schema.discoverySources).where(eq(schema.discoverySources.id, id));

      logger.info({ sourceId: id }, 'Discovery source deleted');

      return reply.status(204).send();
    },
  );

  // GET /status - Current discovery status
  app.get('/status', async (_request, reply: FastifyReply) => {
    const db = getDb();

    const [sourcesResult, contestsFoundResult] = await Promise.all([
      db
        .select({
          id: schema.discoverySources.id,
          name: schema.discoverySources.name,
          type: schema.discoverySources.type,
          isActive: schema.discoverySources.isActive,
          lastRunAt: schema.discoverySources.lastRunAt,
          contestsFound: schema.discoverySources.contestsFound,
          errorCount: schema.discoverySources.errorCount,
        })
        .from(schema.discoverySources)
        .orderBy(desc(schema.discoverySources.lastRunAt)),
      db
        .select({ count: countFn() })
        .from(schema.contests)
        .where(eq(schema.contests.status, 'discovered')),
    ]);

    const lastRun = sourcesResult.find((s) => s.lastRunAt !== null);

    return reply.send({
      data: {
        lastRunAt: lastRun?.lastRunAt ?? null,
        pendingDiscoveries: contestsFoundResult[0]?.count ?? 0,
        sources: sourcesResult.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          isActive: s.isActive === 1,
          lastRunAt: s.lastRunAt,
          contestsFound: s.contestsFound,
          errorCount: s.errorCount,
        })),
      },
    });
  });
}
