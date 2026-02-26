/**
 * CAPTCHA, proxy, and SMS cost tracking.
 * Records individual costs and provides aggregated breakdowns and trends.
 */

import { and, gte, lte, sql, count } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { costLog, entries, wins } from '../db/schema.js';
import { getLogger } from '../shared/logger.js';
import { generateId } from '../shared/crypto.js';
import type {
  DateRange,
  CostLogEntry,
  CostBreakdown,
  TimeSeriesPoint,
} from './types.js';

const log = getLogger('analytics', { service: 'cost-tracker' });

export class CostTracker {
  /**
   * Records a cost entry to the cost_log table.
   */
  async logCost(entry: CostLogEntry): Promise<void> {
    const db = getDb();

    try {
      db.insert(costLog)
        .values({
          id: generateId(),
          category: entry.category,
          provider: entry.provider,
          amount: entry.amount,
          currency: entry.currency || 'USD',
          entryId: entry.entryId ?? null,
          description: entry.description ?? null,
        })
        .run();

      log.debug(
        { category: entry.category, amount: entry.amount, provider: entry.provider },
        'Cost logged',
      );
    } catch (error) {
      log.error({ err: error, entry }, 'Failed to log cost');
      throw error;
    }
  }

  /**
   * Returns the total cost for a given period.
   */
  async getTotalCost(period: DateRange): Promise<number> {
    const db = getDb();

    try {
      const result = db
        .select({
          total: sql<number>`coalesce(sum(${costLog.amount}), 0)`,
        })
        .from(costLog)
        .where(
          and(
            gte(costLog.createdAt, period.from),
            lte(costLog.createdAt, period.to),
          ),
        )
        .get();

      return result?.total ?? 0;
    } catch (error) {
      log.error({ err: error, period }, 'Failed to get total cost');
      return 0;
    }
  }

  /**
   * Returns a detailed cost breakdown for a given period, including per-operation
   * averages and ROI calculations.
   */
  async getCostBreakdown(period: DateRange): Promise<CostBreakdown> {
    const db = getDb();

    try {
      // Costs by category with counts
      const categoryRows = db
        .select({
          category: costLog.category,
          total: sql<number>`coalesce(sum(${costLog.amount}), 0)`,
          cnt: count(),
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

      let grandTotal = 0;
      let captchaTotal = 0;
      let captchaCount = 0;
      let proxyTotal = 0;
      let proxyCount = 0;
      let smsTotal = 0;
      let smsCount = 0;

      for (const row of categoryRows) {
        grandTotal += row.total;
        switch (row.category) {
          case 'captcha':
            captchaTotal = row.total;
            captchaCount = row.cnt;
            break;
          case 'proxy':
            proxyTotal = row.total;
            proxyCount = row.cnt;
            break;
          case 'sms':
            smsTotal = row.total;
            smsCount = row.cnt;
            break;
        }
      }

      // Total entries in the period
      const entryResult = db
        .select({ cnt: count() })
        .from(entries)
        .where(
          and(
            gte(entries.createdAt, period.from),
            lte(entries.createdAt, period.to),
          ),
        )
        .get();

      const totalEntries = entryResult?.cnt ?? 0;

      // Total wins and their value in the period
      const winResult = db
        .select({
          cnt: count(),
          totalValue: sql<number>`coalesce(sum(${wins.prizeValue}), 0)`,
        })
        .from(wins)
        .where(
          and(
            gte(wins.createdAt, period.from),
            lte(wins.createdAt, period.to),
          ),
        )
        .get();

      const totalWins = winResult?.cnt ?? 0;
      const totalWinValue = winResult?.totalValue ?? 0;

      const avgPerEntry = totalEntries > 0 ? grandTotal / totalEntries : 0;
      const avgPerWin = totalWins > 0 ? grandTotal / totalWins : 0;
      const roi = grandTotal > 0 ? (totalWinValue - grandTotal) / grandTotal : 0;

      return {
        total: grandTotal,
        captcha: {
          total: captchaTotal,
          perSolve: captchaCount > 0 ? captchaTotal / captchaCount : 0,
        },
        proxy: {
          total: proxyTotal,
          perRequest: proxyCount > 0 ? proxyTotal / proxyCount : 0,
        },
        sms: {
          total: smsTotal,
          perVerify: smsCount > 0 ? smsTotal / smsCount : 0,
        },
        avgPerEntry,
        avgPerWin,
        roi,
      };
    } catch (error) {
      log.error({ err: error, period }, 'Failed to get cost breakdown');
      return {
        total: 0,
        captcha: { total: 0, perSolve: 0 },
        proxy: { total: 0, perRequest: 0 },
        sms: { total: 0, perVerify: 0 },
        avgPerEntry: 0,
        avgPerWin: 0,
        roi: 0,
      };
    }
  }

  /**
   * Returns cost trend data as a time series.
   */
  async getCostTrend(
    period: DateRange,
    granularity: 'day' | 'week' | 'month',
  ): Promise<TimeSeriesPoint[]> {
    const db = getDb();

    let bucketFormat: string;
    switch (granularity) {
      case 'day':
        bucketFormat = '%Y-%m-%dT00:00:00Z';
        break;
      case 'week':
        bucketFormat = '%Y-W%W';
        break;
      case 'month':
        bucketFormat = '%Y-%m-01T00:00:00Z';
        break;
    }

    try {
      const rows = db
        .select({
          bucket: sql<string>`strftime('${sql.raw(bucketFormat)}', ${costLog.createdAt})`.as('bucket'),
          total: sql<number>`coalesce(sum(${costLog.amount}), 0)`,
        })
        .from(costLog)
        .where(
          and(
            gte(costLog.createdAt, period.from),
            lte(costLog.createdAt, period.to),
          ),
        )
        .groupBy(sql`bucket`)
        .orderBy(sql`bucket asc`)
        .all();

      return rows.map((row) => ({
        timestamp: row.bucket,
        value: row.total,
        label: `$${row.total.toFixed(2)}`,
      }));
    } catch (error) {
      log.error({ err: error, period, granularity }, 'Failed to get cost trend');
      return [];
    }
  }
}
