import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql, desc, gte, lte, and, count as countFn } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { validateQuery } from '../middleware/validator.js';
import { paginationSchema, dateRangeSchema, paginatedResponse } from '../schemas/common.schema.js';

/**
 * Analytics data routes.
 * Provides dashboard summaries, time series, cost breakdowns, and ROI.
 */
export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // GET /overview - Dashboard summary
  app.get('/overview', async (_request, reply: FastifyReply) => {
    const db = getDb();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const [
      entriesTodayResult,
      totalEntriesResult,
      activeContestsResult,
      recentWinsResult,
      costsResult,
      successResult,
    ] = await Promise.all([
      // Entries today
      db
        .select({ count: countFn() })
        .from(schema.entries)
        .where(gte(schema.entries.createdAt, todayIso)),
      // Total entries
      db.select({ count: countFn() }).from(schema.entries),
      // Active contests
      db
        .select({ count: countFn() })
        .from(schema.contests)
        .where(
          sql`${schema.contests.status} IN ('discovered', 'queued', 'active')`,
        ),
      // Recent wins (last 30 days)
      db
        .select({
          win: schema.wins,
          contestTitle: schema.contests.title,
        })
        .from(schema.wins)
        .leftJoin(schema.contests, sql`${schema.wins.contestId} = ${schema.contests.id}`)
        .orderBy(desc(schema.wins.createdAt))
        .limit(5),
      // Costs today
      db
        .select({
          total: sql<number>`COALESCE(SUM(${schema.costLog.amount}), 0)`,
        })
        .from(schema.costLog)
        .where(gte(schema.costLog.createdAt, todayIso)),
      // Success rate
      db
        .select({
          total: countFn(),
          successful: sql<number>`SUM(CASE WHEN ${schema.entries.status} IN ('submitted', 'confirmed', 'won') THEN 1 ELSE 0 END)`,
        })
        .from(schema.entries),
    ]);

    const totalEntries = successResult[0]?.total ?? 0;
    const successfulEntries = Number(successResult[0]?.successful ?? 0);
    const successRate = totalEntries > 0 ? Math.round((successfulEntries / totalEntries) * 10000) / 100 : 0;

    return reply.send({
      data: {
        entriesToday: entriesTodayResult[0]?.count ?? 0,
        totalEntries: totalEntriesResult[0]?.count ?? 0,
        successRate,
        activeContests: activeContestsResult[0]?.count ?? 0,
        recentWins: recentWinsResult.map((r) => ({
          ...r.win,
          contestTitle: r.contestTitle,
        })),
        costsToday: Number(costsResult[0]?.total ?? 0),
        timestamp: new Date().toISOString(),
      },
    });
  });

  // GET /entries - Entry time series
  app.get(
    '/entries',
    {
      preHandler: [
        validateQuery(
          dateRangeSchema.extend({
            granularity: (await import('zod')).z
              .enum(['hour', 'day', 'week', 'month'])
              .default('day'),
          }) as any,
        ),
      ],
    },
    async (request, reply: FastifyReply) => {
      const query = request.query as { from?: string; to?: string; granularity: string };
      const db = getDb();

      // Default to last 30 days
      const fromDate = query.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const toDate = query.to ?? new Date().toISOString();

      let dateFormat: string;
      switch (query.granularity) {
        case 'hour':
          dateFormat = '%Y-%m-%dT%H:00:00Z';
          break;
        case 'week':
          dateFormat = '%Y-W%W';
          break;
        case 'month':
          dateFormat = '%Y-%m';
          break;
        case 'day':
        default:
          dateFormat = '%Y-%m-%d';
      }

      const results = await db
        .select({
          period: sql<string>`strftime('${sql.raw(dateFormat)}', ${schema.entries.createdAt})`,
          total: countFn(),
          successful: sql<number>`SUM(CASE WHEN ${schema.entries.status} IN ('submitted', 'confirmed', 'won') THEN 1 ELSE 0 END)`,
          failed: sql<number>`SUM(CASE WHEN ${schema.entries.status} = 'failed' THEN 1 ELSE 0 END)`,
        })
        .from(schema.entries)
        .where(
          and(
            gte(schema.entries.createdAt, fromDate),
            lte(schema.entries.createdAt, toDate),
          ),
        )
        .groupBy(sql`strftime('${sql.raw(dateFormat)}', ${schema.entries.createdAt})`)
        .orderBy(sql`strftime('${sql.raw(dateFormat)}', ${schema.entries.createdAt})`);

      return reply.send({
        data: results.map((r) => ({
          period: r.period,
          total: r.total,
          successful: Number(r.successful ?? 0),
          failed: Number(r.failed ?? 0),
        })),
        meta: { from: fromDate, to: toDate, granularity: query.granularity },
      });
    },
  );

  // GET /costs - Cost breakdown
  app.get(
    '/costs',
    { preHandler: [validateQuery(dateRangeSchema as any)] },
    async (request, reply: FastifyReply) => {
      const query = request.query as { from?: string; to?: string };
      const db = getDb();

      const fromDate = query.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const toDate = query.to ?? new Date().toISOString();

      const conditions = [
        gte(schema.costLog.createdAt, fromDate),
        lte(schema.costLog.createdAt, toDate),
      ];

      const [byCategory, byProvider, totalResult] = await Promise.all([
        db
          .select({
            category: schema.costLog.category,
            total: sql<number>`SUM(${schema.costLog.amount})`,
            count: countFn(),
          })
          .from(schema.costLog)
          .where(and(...conditions))
          .groupBy(schema.costLog.category),
        db
          .select({
            provider: schema.costLog.provider,
            total: sql<number>`SUM(${schema.costLog.amount})`,
            count: countFn(),
          })
          .from(schema.costLog)
          .where(and(...conditions))
          .groupBy(schema.costLog.provider),
        db
          .select({
            total: sql<number>`COALESCE(SUM(${schema.costLog.amount}), 0)`,
          })
          .from(schema.costLog)
          .where(and(...conditions)),
      ]);

      return reply.send({
        data: {
          total: Number(totalResult[0]?.total ?? 0),
          byCategory: byCategory.map((r) => ({
            category: r.category,
            total: Number(r.total),
            count: r.count,
          })),
          byProvider: byProvider.map((r) => ({
            provider: r.provider,
            total: Number(r.total),
            count: r.count,
          })),
        },
        meta: { from: fromDate, to: toDate },
      });
    },
  );

  // GET /wins - Win history with pagination
  app.get(
    '/wins',
    { preHandler: [validateQuery(paginationSchema as any)] },
    async (request, reply: FastifyReply) => {
      const query = request.query as { page: number; limit: number };
      const db = getDb();
      const offset = (query.page - 1) * query.limit;

      const [winRows, totalResult] = await Promise.all([
        db
          .select({
            win: schema.wins,
            contestTitle: schema.contests.title,
            contestUrl: schema.contests.url,
            contestType: schema.contests.type,
          })
          .from(schema.wins)
          .leftJoin(schema.contests, sql`${schema.wins.contestId} = ${schema.contests.id}`)
          .orderBy(desc(schema.wins.createdAt))
          .limit(query.limit)
          .offset(offset),
        db.select({ count: countFn() }).from(schema.wins),
      ]);

      const total = totalResult[0]?.count ?? 0;
      const results = winRows.map((r) => ({
        ...r.win,
        contest: {
          title: r.contestTitle,
          url: r.contestUrl,
          type: r.contestType,
        },
      }));

      return reply.send(paginatedResponse(results, total, query.page, query.limit));
    },
  );

  // GET /roi - ROI calculations
  app.get('/roi', async (_request, reply: FastifyReply) => {
    const db = getDb();

    const [totalCostsResult, totalWinsValueResult, totalWinsCountResult] = await Promise.all([
      db
        .select({
          total: sql<number>`COALESCE(SUM(${schema.costLog.amount}), 0)`,
        })
        .from(schema.costLog),
      db
        .select({
          total: sql<number>`COALESCE(SUM(${schema.wins.prizeValue}), 0)`,
        })
        .from(schema.wins),
      db.select({ count: countFn() }).from(schema.wins),
    ]);

    const totalCosts = Number(totalCostsResult[0]?.total ?? 0);
    const totalWinsValue = Number(totalWinsValueResult[0]?.total ?? 0);
    const totalWins = totalWinsCountResult[0]?.count ?? 0;
    const netReturn = totalWinsValue - totalCosts;
    const roiPercent = totalCosts > 0 ? Math.round((netReturn / totalCosts) * 10000) / 100 : 0;

    return reply.send({
      data: {
        totalCosts,
        totalWinsValue,
        totalWins,
        netReturn,
        roiPercent,
        avgCostPerWin: totalWins > 0 ? Math.round((totalCosts / totalWins) * 100) / 100 : null,
        avgPrizeValue: totalWins > 0 ? Math.round((totalWinsValue / totalWins) * 100) / 100 : null,
      },
    });
  });

  // GET /sources - Performance by discovery source
  app.get('/sources', async (_request, reply: FastifyReply) => {
    const db = getDb();

    const sourceStats = await db
      .select({
        source: schema.contests.source,
        contestCount: countFn(),
        totalEntries: sql<number>`(
          SELECT COUNT(*) FROM entries
          WHERE entries.contest_id = contests.id
        )`,
        successfulEntries: sql<number>`(
          SELECT COUNT(*) FROM entries
          WHERE entries.contest_id = contests.id
          AND entries.status IN ('submitted', 'confirmed', 'won')
        )`,
        totalWins: sql<number>`(
          SELECT COUNT(*) FROM wins
          WHERE wins.contest_id = contests.id
        )`,
      })
      .from(schema.contests)
      .groupBy(schema.contests.source)
      .orderBy(desc(countFn()));

    return reply.send({
      data: sourceStats.map((s) => ({
        source: s.source ?? 'unknown',
        contestCount: s.contestCount,
        totalEntries: Number(s.totalEntries ?? 0),
        successfulEntries: Number(s.successfulEntries ?? 0),
        totalWins: Number(s.totalWins ?? 0),
        successRate:
          Number(s.totalEntries ?? 0) > 0
            ? Math.round(
                (Number(s.successfulEntries ?? 0) / Number(s.totalEntries ?? 0)) * 10000,
              ) / 100
            : 0,
      })),
    });
  });
}
