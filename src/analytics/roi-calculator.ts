/**
 * ROI (Return on Investment) calculator for sweepstakes operations.
 * Computes expected value, net profit, and per-contest performance.
 */

import { and, gte, lte, eq, sql, count } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { entries, wins, costLog, contests } from '../db/schema.js';
import { getLogger } from '../shared/logger.js';
import type { DateRange, ROIData, ContestROI } from './types.js';

const log = getLogger('analytics', { service: 'roi-calculator' });

const MS_PER_DAY = 86_400_000;

export class ROICalculator {
  /**
   * Calculates overall ROI for a given period.
   */
  async calculateROI(period: DateRange): Promise<ROIData> {
    const db = getDb();

    try {
      // Total cost
      const costResult = db
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

      const totalCost = costResult?.total ?? 0;

      // Total win value
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

      const totalWins = winResult?.cnt ?? 0;
      const totalWinValue = winResult?.totalValue ?? 0;
      const avgWinValue = winResult?.avgValue ?? 0;

      // Total entries
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

      const netProfit = totalWinValue - totalCost;
      const roi = totalCost > 0 ? netProfit / totalCost : 0;
      const costPerEntry = totalEntries > 0 ? totalCost / totalEntries : 0;
      const costPerWin = totalWins > 0 ? totalCost / totalWins : 0;
      const winRate = totalEntries > 0 ? totalWins / totalEntries : 0;

      // Project monthly ROI based on the daily rate in this period
      const periodDays = Math.max(
        1,
        (new Date(period.to).getTime() - new Date(period.from).getTime()) / MS_PER_DAY,
      );
      const dailyProfit = netProfit / periodDays;
      const projectedMonthlyROI = dailyProfit * 30;

      return {
        totalCost,
        totalWinValue,
        netProfit,
        roi,
        costPerEntry,
        costPerWin,
        avgWinValue,
        winRate,
        projectedMonthlyROI,
      };
    } catch (error) {
      log.error({ err: error, period }, 'Failed to calculate ROI');
      return {
        totalCost: 0,
        totalWinValue: 0,
        netProfit: 0,
        roi: 0,
        costPerEntry: 0,
        costPerWin: 0,
        avgWinValue: 0,
        winRate: 0,
        projectedMonthlyROI: 0,
      };
    }
  }

  /**
   * Calculates ROI for a specific contest.
   */
  async calculateContestROI(contestId: string): Promise<ContestROI> {
    const db = getDb();

    try {
      // Contest title
      const contest = db
        .select({ title: contests.title })
        .from(contests)
        .where(eq(contests.id, contestId))
        .get();

      const contestTitle = contest?.title ?? 'Unknown';

      // Total entries for this contest
      const entryResult = db
        .select({ cnt: count() })
        .from(entries)
        .where(eq(entries.contestId, contestId))
        .get();

      const totalEntries = entryResult?.cnt ?? 0;

      // Total wins and value for this contest
      const winResult = db
        .select({
          cnt: count(),
          totalValue: sql<number>`coalesce(sum(${wins.prizeValue}), 0)`,
        })
        .from(wins)
        .where(eq(wins.contestId, contestId))
        .get();

      const totalWins = winResult?.cnt ?? 0;
      const totalWinValue = winResult?.totalValue ?? 0;

      // Total cost for entries in this contest
      // We sum cost_log rows that reference entries belonging to this contest.
      const costResult = db
        .select({
          total: sql<number>`coalesce(sum(${costLog.amount}), 0)`,
        })
        .from(costLog)
        .innerJoin(entries, eq(costLog.entryId, entries.id))
        .where(eq(entries.contestId, contestId))
        .get();

      const totalCost = costResult?.total ?? 0;
      const netProfit = totalWinValue - totalCost;
      const roi = totalCost > 0 ? netProfit / totalCost : 0;

      return {
        contestId,
        contestTitle,
        totalCost,
        totalWinValue,
        netProfit,
        roi,
        entries: totalEntries,
        wins: totalWins,
      };
    } catch (error) {
      log.error({ err: error, contestId }, 'Failed to calculate contest ROI');
      return {
        contestId,
        contestTitle: 'Unknown',
        totalCost: 0,
        totalWinValue: 0,
        netProfit: 0,
        roi: 0,
        entries: 0,
        wins: 0,
      };
    }
  }

  /**
   * Returns the top contests ranked by ROI.
   */
  async getTopROIContests(limit = 10): Promise<ContestROI[]> {
    const db = getDb();

    try {
      // Get all contests that have at least one win
      const contestsWithWins = db
        .select({
          contestId: wins.contestId,
        })
        .from(wins)
        .groupBy(wins.contestId)
        .all();

      if (contestsWithWins.length === 0) {
        return [];
      }

      // Calculate ROI for each contest with wins
      const roiPromises = contestsWithWins.map((row) =>
        this.calculateContestROI(row.contestId),
      );

      const results = await Promise.all(roiPromises);

      // Sort by ROI descending and take top N
      return results
        .sort((a, b) => b.roi - a.roi)
        .slice(0, limit);
    } catch (error) {
      log.error({ err: error }, 'Failed to get top ROI contests');
      return [];
    }
  }
}
