/**
 * Collects and aggregates operational metrics from the database.
 */

import { and, gte, lte, eq, sql, count } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  entries,
  contests,
  wins,
  costLog,
} from '../db/schema.js';
import { getLogger } from '../shared/logger.js';
import type {
  DateRange,
  EntryMetrics,
  CostMetrics,
  DiscoveryMetrics,
  WinMetrics,
} from './types.js';

const log = getLogger('analytics', { service: 'metrics-collector' });

export class MetricsCollector {
  /**
   * Collects entry submission metrics for a given period.
   */
  async collectEntryMetrics(period: DateRange): Promise<EntryMetrics> {
    const db = getDb();

    try {
      // Status breakdown
      const statusRows = db
        .select({
          status: entries.status,
          cnt: count(),
        })
        .from(entries)
        .where(
          and(
            gte(entries.createdAt, period.from),
            lte(entries.createdAt, period.to),
          ),
        )
        .groupBy(entries.status)
        .all();

      const byStatus: Record<string, number> = {};
      let total = 0;
      let successful = 0;
      let failed = 0;

      for (const row of statusRows) {
        byStatus[row.status] = row.cnt;
        total += row.cnt;
        if (row.status === 'submitted' || row.status === 'confirmed' || row.status === 'won') {
          successful += row.cnt;
        } else if (row.status === 'failed') {
          failed += row.cnt;
        }
      }

      // Average duration
      const durationResult = db
        .select({
          avgDuration: sql<number>`coalesce(avg(${entries.durationMs}), 0)`,
        })
        .from(entries)
        .where(
          and(
            gte(entries.createdAt, period.from),
            lte(entries.createdAt, period.to),
            sql`${entries.durationMs} is not null`,
          ),
        )
        .get();

      // By entry method (type)
      const typeRows = db
        .select({
          method: entries.entryMethod,
          cnt: count(),
        })
        .from(entries)
        .where(
          and(
            gte(entries.createdAt, period.from),
            lte(entries.createdAt, period.to),
          ),
        )
        .groupBy(entries.entryMethod)
        .all();

      const byType: Record<string, number> = {};
      for (const row of typeRows) {
        const key = row.method ?? 'unknown';
        byType[key] = row.cnt;
      }

      // By source (contest source)
      const sourceRows = db
        .select({
          source: contests.source,
          cnt: count(),
        })
        .from(entries)
        .innerJoin(contests, eq(entries.contestId, contests.id))
        .where(
          and(
            gte(entries.createdAt, period.from),
            lte(entries.createdAt, period.to),
          ),
        )
        .groupBy(contests.source)
        .all();

      const bySource: Record<string, number> = {};
      for (const row of sourceRows) {
        const key = row.source ?? 'unknown';
        bySource[key] = row.cnt;
      }

      return {
        total,
        successful,
        failed,
        successRate: total > 0 ? successful / total : 0,
        avgDurationMs: durationResult?.avgDuration ?? 0,
        byType,
        bySource,
        byStatus,
      };
    } catch (error) {
      log.error({ err: error, period }, 'Failed to collect entry metrics');
      return {
        total: 0,
        successful: 0,
        failed: 0,
        successRate: 0,
        avgDurationMs: 0,
        byType: {},
        bySource: {},
        byStatus: {},
      };
    }
  }

  /**
   * Collects cost metrics for a given period.
   */
  async collectCostMetrics(period: DateRange): Promise<CostMetrics> {
    const db = getDb();

    try {
      // Cost by category
      const categoryRows = db
        .select({
          category: costLog.category,
          total: sql<number>`coalesce(sum(${costLog.amount}), 0)`,
        })
        .from(costLog)
        .where(
          and(
            gte(costLog.createdAt, period.from),
            lte(costLog.createdAt, period.to),
          ),
        )
        .groupBy(costLog.category)
        .all();

      let totalCost = 0;
      let byCaptcha = 0;
      let byProxy = 0;
      let bySms = 0;
      let bySocial = 0;

      for (const row of categoryRows) {
        totalCost += row.total;
        switch (row.category) {
          case 'captcha': byCaptcha = row.total; break;
          case 'proxy': byProxy = row.total; break;
          case 'sms': bySms = row.total; break;
          case 'social': bySocial = row.total; break;
        }
      }

      // Count entries for cost-per-entry calculation
      const entryCountResult = db
        .select({ cnt: count() })
        .from(entries)
        .where(
          and(
            gte(entries.createdAt, period.from),
            lte(entries.createdAt, period.to),
          ),
        )
        .get();

      const totalEntries = entryCountResult?.cnt ?? 0;

      // Count wins for cost-per-win calculation
      const winCountResult = db
        .select({ cnt: count() })
        .from(wins)
        .where(
          and(
            gte(wins.createdAt, period.from),
            lte(wins.createdAt, period.to),
          ),
        )
        .get();

      const totalWins = winCountResult?.cnt ?? 0;

      return {
        total: totalCost,
        byCaptcha,
        byProxy,
        bySms,
        bySocial,
        avgCostPerEntry: totalEntries > 0 ? totalCost / totalEntries : 0,
        costPerWin: totalWins > 0 ? totalCost / totalWins : 0,
      };
    } catch (error) {
      log.error({ err: error, period }, 'Failed to collect cost metrics');
      return {
        total: 0,
        byCaptcha: 0,
        byProxy: 0,
        bySms: 0,
        bySocial: 0,
        avgCostPerEntry: 0,
        costPerWin: 0,
      };
    }
  }

  /**
   * Collects contest discovery metrics for a given period.
   */
  async collectDiscoveryMetrics(period: DateRange): Promise<DiscoveryMetrics> {
    const db = getDb();

    try {
      // Total discovered in period
      const totalResult = db
        .select({ cnt: count() })
        .from(contests)
        .where(
          and(
            gte(contests.createdAt, period.from),
            lte(contests.createdAt, period.to),
          ),
        )
        .get();

      // By source
      const sourceRows = db
        .select({
          source: contests.source,
          cnt: count(),
        })
        .from(contests)
        .where(
          and(
            gte(contests.createdAt, period.from),
            lte(contests.createdAt, period.to),
          ),
        )
        .groupBy(contests.source)
        .all();

      const bySource: Record<string, number> = {};
      for (const row of sourceRows) {
        const key = row.source ?? 'unknown';
        bySource[key] = row.cnt;
      }

      // New today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const newTodayResult = db
        .select({ cnt: count() })
        .from(contests)
        .where(
          and(
            gte(contests.createdAt, todayStart.toISOString()),
            lte(contests.createdAt, todayEnd.toISOString()),
          ),
        )
        .get();

      // Expiring today
      const expiringResult = db
        .select({ cnt: count() })
        .from(contests)
        .where(
          and(
            gte(contests.endDate, todayStart.toISOString()),
            lte(contests.endDate, todayEnd.toISOString()),
          ),
        )
        .get();

      return {
        totalDiscovered: totalResult?.cnt ?? 0,
        bySource,
        newToday: newTodayResult?.cnt ?? 0,
        expiringToday: expiringResult?.cnt ?? 0,
      };
    } catch (error) {
      log.error({ err: error, period }, 'Failed to collect discovery metrics');
      return {
        totalDiscovered: 0,
        bySource: {},
        newToday: 0,
        expiringToday: 0,
      };
    }
  }

  /**
   * Collects win metrics for a given period.
   */
  async collectWinMetrics(period: DateRange): Promise<WinMetrics> {
    const db = getDb();

    try {
      // Total wins and value
      const winResult = db
        .select({
          cnt: count(),
          totalValue: sql<number>`coalesce(sum(${wins.prizeValue}), 0)`,
          avgValue: sql<number>`coalesce(avg(${wins.prizeValue}), 0)`,
        })
        .from(wins)
        .where(
          and(
            gte(wins.createdAt, period.from),
            lte(wins.createdAt, period.to),
          ),
        )
        .get();

      // By prize category
      const categoryRows = db
        .select({
          category: contests.prizeCategory,
          cnt: count(),
        })
        .from(wins)
        .innerJoin(contests, eq(wins.contestId, contests.id))
        .where(
          and(
            gte(wins.createdAt, period.from),
            lte(wins.createdAt, period.to),
          ),
        )
        .groupBy(contests.prizeCategory)
        .all();

      const byCategory: Record<string, number> = {};
      for (const row of categoryRows) {
        const key = row.category ?? 'uncategorized';
        byCategory[key] = row.cnt;
      }

      // Claim rate
      const claimedResult = db
        .select({ cnt: count() })
        .from(wins)
        .where(
          and(
            gte(wins.createdAt, period.from),
            lte(wins.createdAt, period.to),
            eq(wins.claimStatus, 'claimed'),
          ),
        )
        .get();

      const totalWins = winResult?.cnt ?? 0;
      const claimed = claimedResult?.cnt ?? 0;

      return {
        totalWins,
        totalValue: winResult?.totalValue ?? 0,
        avgValue: winResult?.avgValue ?? 0,
        byCategory,
        claimRate: totalWins > 0 ? claimed / totalWins : 0,
      };
    } catch (error) {
      log.error({ err: error, period }, 'Failed to collect win metrics');
      return {
        totalWins: 0,
        totalValue: 0,
        avgValue: 0,
        byCategory: {},
        claimRate: 0,
      };
    }
  }
}
