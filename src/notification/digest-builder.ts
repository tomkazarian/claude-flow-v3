/**
 * Builds daily and weekly activity digest summaries from database data.
 */

import { and, gte, lte, eq, sql, count } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  entries,
  contests,
  wins,
  costLog,
  proxies,
} from '../db/schema.js';
import { getLogger } from '../shared/logger.js';
import type { DigestData } from './types.js';

const log = getLogger('notification', { service: 'digest-builder' });

export class DigestBuilder {
  /**
   * Builds a daily digest for the last 24 hours.
   */
  async buildDailyDigest(): Promise<DigestData> {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    return this.buildDigest(
      from.toISOString(),
      now.toISOString(),
      'Daily',
    );
  }

  /**
   * Builds a weekly digest for the last 7 days.
   */
  async buildWeeklyDigest(): Promise<DigestData> {
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    return this.buildDigest(
      from.toISOString(),
      now.toISOString(),
      'Weekly',
    );
  }

  /**
   * Builds a digest for a given time range.
   */
  private async buildDigest(
    from: string,
    to: string,
    label: string,
  ): Promise<DigestData> {
    const db = getDb();

    log.info({ from, to, label }, 'Building digest');

    // Gather all stats in parallel
    const [
      entryStats,
      winStats,
      costStats,
      discoveryStats,
      topContestsList,
      recentWinsList,
      deadlinesList,
      healthStats,
    ] = await Promise.all([
      this.getEntryStats(db, from, to),
      this.getWinStats(db, from, to),
      this.getCostStats(db, from, to),
      this.getDiscoveryStats(db, from, to),
      this.getTopContests(db, from, to),
      this.getRecentWins(db, from, to),
      this.getUpcomingDeadlines(db, to),
      this.getSystemHealth(db),
    ]);

    return {
      period: {
        from,
        to,
        label: `${label} Digest`,
      },
      stats: {
        totalEntries: entryStats.total,
        successfulEntries: entryStats.successful,
        failedEntries: entryStats.failed,
        newContestsDiscovered: discoveryStats,
        wins: winStats.totalWins,
        totalCost: costStats,
      },
      topContests: topContestsList,
      recentWins: recentWinsList,
      upcomingDeadlines: deadlinesList,
      systemHealth: healthStats,
    };
  }

  private async getEntryStats(
    db: ReturnType<typeof getDb>,
    from: string,
    to: string,
  ): Promise<{ total: number; successful: number; failed: number }> {
    try {
      const rows = db
        .select({
          status: entries.status,
          cnt: count(),
        })
        .from(entries)
        .where(
          and(
            gte(entries.createdAt, from),
            lte(entries.createdAt, to),
          ),
        )
        .groupBy(entries.status)
        .all();

      let total = 0;
      let successful = 0;
      let failed = 0;

      for (const row of rows) {
        const c = row.cnt;
        total += c;
        if (row.status === 'submitted' || row.status === 'confirmed' || row.status === 'won') {
          successful += c;
        } else if (row.status === 'failed') {
          failed += c;
        }
      }

      return { total, successful, failed };
    } catch (error) {
      log.error({ err: error }, 'Failed to query entry stats');
      return { total: 0, successful: 0, failed: 0 };
    }
  }

  private async getWinStats(
    db: ReturnType<typeof getDb>,
    from: string,
    to: string,
  ): Promise<{ totalWins: number; totalValue: number }> {
    try {
      const result = db
        .select({
          cnt: count(),
          totalValue: sql<number>`coalesce(sum(${wins.prizeValue}), 0)`,
        })
        .from(wins)
        .where(
          and(
            gte(wins.createdAt, from),
            lte(wins.createdAt, to),
          ),
        )
        .get();

      return {
        totalWins: result?.cnt ?? 0,
        totalValue: result?.totalValue ?? 0,
      };
    } catch (error) {
      log.error({ err: error }, 'Failed to query win stats');
      return { totalWins: 0, totalValue: 0 };
    }
  }

  private async getCostStats(
    db: ReturnType<typeof getDb>,
    from: string,
    to: string,
  ): Promise<number> {
    try {
      const result = db
        .select({
          total: sql<number>`coalesce(sum(${costLog.amount}), 0)`,
        })
        .from(costLog)
        .where(
          and(
            gte(costLog.createdAt, from),
            lte(costLog.createdAt, to),
          ),
        )
        .get();

      return result?.total ?? 0;
    } catch (error) {
      log.error({ err: error }, 'Failed to query cost stats');
      return 0;
    }
  }

  private async getDiscoveryStats(
    db: ReturnType<typeof getDb>,
    from: string,
    to: string,
  ): Promise<number> {
    try {
      const result = db
        .select({
          cnt: count(),
        })
        .from(contests)
        .where(
          and(
            gte(contests.createdAt, from),
            lte(contests.createdAt, to),
          ),
        )
        .get();

      return result?.cnt ?? 0;
    } catch (error) {
      log.error({ err: error }, 'Failed to query discovery stats');
      return 0;
    }
  }

  private async getTopContests(
    db: ReturnType<typeof getDb>,
    from: string,
    to: string,
    limit = 5,
  ): Promise<DigestData['topContests']> {
    try {
      const rows = db
        .select({
          contestId: entries.contestId,
          title: contests.title,
          total: count(),
          successful: sql<number>`sum(case when ${entries.status} in ('submitted','confirmed','won') then 1 else 0 end)`,
        })
        .from(entries)
        .innerJoin(contests, eq(entries.contestId, contests.id))
        .where(
          and(
            gte(entries.createdAt, from),
            lte(entries.createdAt, to),
          ),
        )
        .groupBy(entries.contestId, contests.title)
        .orderBy(sql`count(*) desc`)
        .limit(limit)
        .all();

      return rows.map((row) => ({
        contestId: row.contestId,
        title: row.title,
        entries: row.total,
        successRate: row.total > 0 ? row.successful / row.total : 0,
      }));
    } catch (error) {
      log.error({ err: error }, 'Failed to query top contests');
      return [];
    }
  }

  private async getRecentWins(
    db: ReturnType<typeof getDb>,
    from: string,
    to: string,
    limit = 5,
  ): Promise<DigestData['recentWins']> {
    try {
      const rows = db
        .select({
          winId: wins.id,
          contestTitle: contests.title,
          prizeDescription: wins.prizeDescription,
          prizeValue: wins.prizeValue,
          createdAt: wins.createdAt,
        })
        .from(wins)
        .innerJoin(contests, eq(wins.contestId, contests.id))
        .where(
          and(
            gte(wins.createdAt, from),
            lte(wins.createdAt, to),
          ),
        )
        .orderBy(sql`${wins.createdAt} desc`)
        .limit(limit)
        .all();

      return rows.map((row) => ({
        winId: row.winId,
        contestTitle: row.contestTitle,
        prizeDescription: row.prizeDescription ?? 'Unknown prize',
        prizeValue: row.prizeValue,
        claimedAt: row.createdAt,
      }));
    } catch (error) {
      log.error({ err: error }, 'Failed to query recent wins');
      return [];
    }
  }

  private async getUpcomingDeadlines(
    db: ReturnType<typeof getDb>,
    currentDate: string,
    limit = 5,
  ): Promise<DigestData['upcomingDeadlines']> {
    try {
      // Find contests ending within the next 48 hours
      const deadline = new Date(
        new Date(currentDate).getTime() + 48 * 60 * 60 * 1000,
      ).toISOString();

      const rows = db
        .select({
          contestId: contests.id,
          title: contests.title,
          endDate: contests.endDate,
        })
        .from(contests)
        .where(
          and(
            gte(contests.endDate, currentDate),
            lte(contests.endDate, deadline),
            eq(contests.status, 'active'),
          ),
        )
        .orderBy(contests.endDate)
        .limit(limit)
        .all();

      return rows
        .filter((r): r is typeof r & { endDate: string } => r.endDate != null)
        .map((row) => ({
          contestId: row.contestId,
          title: row.title,
          endDate: row.endDate,
        }));
    } catch (error) {
      log.error({ err: error }, 'Failed to query upcoming deadlines');
      return [];
    }
  }

  private async getSystemHealth(
    db: ReturnType<typeof getDb>,
  ): Promise<DigestData['systemHealth']> {
    try {
      // Count active proxies
      const proxyResult = db
        .select({ cnt: count() })
        .from(proxies)
        .where(
          and(
            eq(proxies.isActive, 1),
            eq(proxies.healthStatus, 'healthy'),
          ),
        )
        .get();

      // Compute error rate from the last hour
      const oneHourAgo = new Date(
        Date.now() - 60 * 60 * 1000,
      ).toISOString();

      const entryStatusRows = db
        .select({
          status: entries.status,
          cnt: count(),
        })
        .from(entries)
        .where(gte(entries.createdAt, oneHourAgo))
        .groupBy(entries.status)
        .all();

      let totalRecent = 0;
      let failedRecent = 0;
      for (const row of entryStatusRows) {
        totalRecent += row.cnt;
        if (row.status === 'failed') {
          failedRecent += row.cnt;
        }
      }

      const errorRate = totalRecent > 0 ? failedRecent / totalRecent : 0;

      return {
        activeBrowsers: 0, // Not tracked in DB; would need runtime state
        activeProxies: proxyResult?.cnt ?? 0,
        queueSize: 0, // Would need Redis/BullMQ query; not available from SQLite
        errorRate,
      };
    } catch (error) {
      log.error({ err: error }, 'Failed to query system health');
      return {
        activeBrowsers: 0,
        activeProxies: 0,
        queueSize: 0,
        errorRate: 0,
      };
    }
  }
}
