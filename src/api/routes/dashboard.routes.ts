/**
 * Dashboard summary routes.
 * Provides aggregated stats for the main dashboard page.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { sql, gte, desc, count as countFn } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // GET /stats - Dashboard summary stats
  app.get('/stats', async (_request, reply: FastifyReply) => {
    const db = getDb();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayIso = yesterdayStart.toISOString();

    const [
      entriesTodayResult,
      entriesYesterdayResult,
      successResult,
      activeContestsResult,
      winsResult,
      recentWinResult,
    ] = await Promise.all([
      // Entries today
      db
        .select({ count: countFn() })
        .from(schema.entries)
        .where(gte(schema.entries.createdAt, todayIso)),
      // Entries yesterday
      db
        .select({ count: countFn() })
        .from(schema.entries)
        .where(
          sql`${schema.entries.createdAt} >= ${yesterdayIso} AND ${schema.entries.createdAt} < ${todayIso}`,
        ),
      // Success rate (all time)
      db
        .select({
          total: countFn(),
          successful: sql<number>`SUM(CASE WHEN ${schema.entries.status} IN ('submitted', 'confirmed', 'won') THEN 1 ELSE 0 END)`,
        })
        .from(schema.entries),
      // Active contests
      db
        .select({ count: countFn() })
        .from(schema.contests)
        .where(
          sql`${schema.contests.status} IN ('discovered', 'queued', 'active')`,
        ),
      // Total wins and prize value
      db
        .select({
          count: countFn(),
          totalValue: sql<number>`COALESCE(SUM(${schema.wins.prizeValue}), 0)`,
        })
        .from(schema.wins),
      // Most recent win
      db
        .select({
          contestId: schema.wins.contestId,
          prizeDescription: schema.wins.prizeDescription,
          prizeValue: schema.wins.prizeValue,
          createdAt: schema.wins.createdAt,
          entryId: schema.wins.entryId,
          contestTitle: schema.contests.title,
        })
        .from(schema.wins)
        .leftJoin(schema.contests, sql`${schema.wins.contestId} = ${schema.contests.id}`)
        .orderBy(desc(schema.wins.createdAt))
        .limit(1),
    ]);

    const totalEntries = Number(successResult[0]?.total ?? 0);
    const successfulEntries = Number(successResult[0]?.successful ?? 0);
    const successRate = totalEntries > 0 ? Math.round((successfulEntries / totalEntries) * 10000) / 100 : 0;

    const recentWin = recentWinResult[0]
      ? {
          contestTitle: recentWinResult[0].contestTitle ?? 'Unknown Contest',
          prizeDescription: recentWinResult[0].prizeDescription ?? '',
          prizeValue: recentWinResult[0].prizeValue ?? 0,
          wonAt: recentWinResult[0].createdAt ?? '',
          entryId: recentWinResult[0].entryId ?? '',
        }
      : null;

    return reply.send({
      entriesToday: entriesTodayResult[0]?.count ?? 0,
      entriesYesterday: entriesYesterdayResult[0]?.count ?? 0,
      successRate,
      activeContests: activeContestsResult[0]?.count ?? 0,
      totalWins: winsResult[0]?.count ?? 0,
      totalPrizeValue: Number(winsResult[0]?.totalValue ?? 0),
      recentWin,
    });
  });
}
