import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, desc, and, sql, count as countFn, gte, lte, inArray } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { generateId } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';
import { getLogger } from '../../shared/logger.js';
import { validateQuery, validateParams, validateBody } from '../middleware/validator.js';
import { idParamSchema, paginatedResponse } from '../schemas/common.schema.js';
import {
  entryFilterSchema,
  retryEntrySchema,
  exportFormatSchema,
  type EntryFilterInput,
  type RetryEntryInput,
  type ExportFormatInput,
} from '../schemas/entry.schema.js';

const logger = getLogger('server', { component: 'entries' });

/**
 * Entry history and management routes.
 */
export async function entryRoutes(app: FastifyInstance): Promise<void> {
  // GET / - List entries with pagination and filtering
  app.get(
    '/',
    { preHandler: [validateQuery(entryFilterSchema as any)] },
    async (request, reply: FastifyReply) => {
      const { page, limit, status, contestId, profileId, from, to } = request.query as EntryFilterInput;
      const db = getDb();
      const offset = (page - 1) * limit;

      const conditions: ReturnType<typeof eq>[] = [];

      if (status) {
        const statuses = Array.isArray(status) ? status : [status];
        conditions.push(
          inArray(schema.entries.status, statuses as any),
        );
      }

      if (contestId) {
        conditions.push(eq(schema.entries.contestId, contestId));
      }

      if (profileId) {
        conditions.push(eq(schema.entries.profileId, profileId));
      }

      if (from) {
        conditions.push(gte(schema.entries.createdAt, from));
      }

      if (to) {
        conditions.push(lte(schema.entries.createdAt, to));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [entryRows, totalResult] = await Promise.all([
        db
          .select()
          .from(schema.entries)
          .where(whereClause)
          .orderBy(desc(schema.entries.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: countFn() })
          .from(schema.entries)
          .where(whereClause),
      ]);

      const total = totalResult[0]?.count ?? 0;

      return reply.send(paginatedResponse(entryRows, total, page, limit));
    },
  );

  // GET /stats - Aggregate entry statistics
  app.get('/stats', async (_request, reply: FastifyReply) => {
    const db = getDb();

    const statsResult = await db
      .select({
        total: countFn(),
        pending: sql<number>`SUM(CASE WHEN ${schema.entries.status} = 'pending' THEN 1 ELSE 0 END)`,
        submitted: sql<number>`SUM(CASE WHEN ${schema.entries.status} = 'submitted' THEN 1 ELSE 0 END)`,
        confirmed: sql<number>`SUM(CASE WHEN ${schema.entries.status} = 'confirmed' THEN 1 ELSE 0 END)`,
        failed: sql<number>`SUM(CASE WHEN ${schema.entries.status} = 'failed' THEN 1 ELSE 0 END)`,
        won: sql<number>`SUM(CASE WHEN ${schema.entries.status} = 'won' THEN 1 ELSE 0 END)`,
        lost: sql<number>`SUM(CASE WHEN ${schema.entries.status} = 'lost' THEN 1 ELSE 0 END)`,
        expired: sql<number>`SUM(CASE WHEN ${schema.entries.status} = 'expired' THEN 1 ELSE 0 END)`,
        duplicate: sql<number>`SUM(CASE WHEN ${schema.entries.status} = 'duplicate' THEN 1 ELSE 0 END)`,
        avgDurationMs: sql<number>`AVG(${schema.entries.durationMs})`,
        totalCaptchaCost: sql<number>`COALESCE(SUM(${schema.entries.captchaCost}), 0)`,
      })
      .from(schema.entries);

    const stats = statsResult[0];
    const total = stats?.total ?? 0;
    const successful = Number(stats?.submitted ?? 0) + Number(stats?.confirmed ?? 0) + Number(stats?.won ?? 0);
    const successRate = total > 0 ? Math.round((successful / total) * 10000) / 100 : 0;

    return reply.send({
      data: {
        total,
        byStatus: {
          pending: Number(stats?.pending ?? 0),
          submitted: Number(stats?.submitted ?? 0),
          confirmed: Number(stats?.confirmed ?? 0),
          failed: Number(stats?.failed ?? 0),
          won: Number(stats?.won ?? 0),
          lost: Number(stats?.lost ?? 0),
          expired: Number(stats?.expired ?? 0),
          duplicate: Number(stats?.duplicate ?? 0),
        },
        successRate,
        avgDurationMs: stats?.avgDurationMs ? Math.round(stats.avgDurationMs) : null,
        totalCaptchaCost: Number(stats?.totalCaptchaCost ?? 0),
      },
    });
  });

  // GET /export - Export entries as CSV or JSON
  app.get(
    '/export',
    { preHandler: [validateQuery(exportFormatSchema as any)] },
    async (request, reply: FastifyReply) => {
      const { format } = request.query as ExportFormatInput;
      const db = getDb();

      const allEntries = await db
        .select()
        .from(schema.entries)
        .orderBy(desc(schema.entries.createdAt));

      if (format === 'csv') {
        if (allEntries.length === 0) {
          return reply
            .header('Content-Type', 'text/csv')
            .header('Content-Disposition', 'attachment; filename="entries.csv"')
            .send('');
        }

        const keys = Object.keys(allEntries[0]!) as (keyof typeof allEntries[0])[];
        const header = keys.join(',');
        const rows = allEntries.map((entry) =>
          keys
            .map((key) => {
              const val = entry[key];
              if (val === null || val === undefined) return '';
              const str = String(val);
              // Escape CSV values that contain commas, quotes, or newlines
              if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
              }
              return str;
            })
            .join(','),
        );

        const csv = [header, ...rows].join('\n');

        return reply
          .header('Content-Type', 'text/csv')
          .header('Content-Disposition', 'attachment; filename="entries.csv"')
          .send(csv);
      }

      // Default: JSON
      return reply
        .header('Content-Disposition', 'attachment; filename="entries.json"')
        .send({ data: allEntries });
    },
  );

  // GET /:id - Entry detail with contest info and screenshots
  app.get(
    '/:id',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const entryRows = await db
        .select({
          entry: schema.entries,
          contest: {
            id: schema.contests.id,
            title: schema.contests.title,
            url: schema.contests.url,
            type: schema.contests.type,
            entryMethod: schema.contests.entryMethod,
            prizeDescription: schema.contests.prizeDescription,
            prizeValue: schema.contests.prizeValue,
            endDate: schema.contests.endDate,
            status: schema.contests.status,
          },
        })
        .from(schema.entries)
        .leftJoin(schema.contests, eq(schema.entries.contestId, schema.contests.id))
        .where(eq(schema.entries.id, id))
        .limit(1);

      if (entryRows.length === 0) {
        throw new AppError('Entry not found', 'ENTRY_NOT_FOUND', 404);
      }

      const row = entryRows[0]!;

      return reply.send({
        data: {
          ...row.entry,
          contest: row.contest,
        },
      });
    },
  );

  // POST /:id/retry - Retry a failed entry
  app.post(
    '/:id/retry',
    { preHandler: [validateParams(idParamSchema), validateBody(retryEntrySchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const existing = await db
        .select()
        .from(schema.entries)
        .where(eq(schema.entries.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new AppError('Entry not found', 'ENTRY_NOT_FOUND', 404);
      }

      const entry = existing[0]!;

      if (entry.status !== 'failed') {
        throw new AppError(
          `Cannot retry entry with status '${entry.status}'. Only failed entries can be retried.`,
          'ENTRY_NOT_RETRYABLE',
          400,
        );
      }

      const retryBody = request.body as RetryEntryInput;
      const profileId = retryBody.profileId ?? entry.profileId;
      const entryId = generateId();
      const now = new Date().toISOString();

      await db.insert(schema.entries).values({
        id: entryId,
        contestId: entry.contestId,
        profileId,
        status: 'pending',
        attemptNumber: entry.attemptNumber + 1,
        createdAt: now,
        updatedAt: now,
      });

      logger.info(
        { entryId, previousEntryId: id, contestId: entry.contestId },
        'Entry retried',
      );

      return reply.status(202).send({
        data: {
          entryId,
          contestId: entry.contestId,
          profileId,
          attemptNumber: entry.attemptNumber + 1,
          status: 'pending',
          message: 'Entry retry has been queued',
        },
      });
    },
  );

  // DELETE /:id - Remove entry record
  app.delete(
    '/:id',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const existing = await db
        .select({ id: schema.entries.id })
        .from(schema.entries)
        .where(eq(schema.entries.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new AppError('Entry not found', 'ENTRY_NOT_FOUND', 404);
      }

      await db.delete(schema.entries).where(eq(schema.entries.id, id));

      logger.info({ entryId: id }, 'Entry deleted');

      return reply.status(204).send();
    },
  );
}
