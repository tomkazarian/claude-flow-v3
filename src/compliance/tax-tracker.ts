/**
 * Prize value tracking and tax reporting.
 *
 * Tracks cumulative winnings per profile per tax year and determines
 * whether IRS reporting thresholds have been met. Generates summary
 * reports for tax compliance.
 */

import { eq, and, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getLogger } from '../shared/logger.js';
import { formatCurrency } from '../shared/utils.js';
import { wins } from '../db/schema.js';

const logger = getLogger('compliance', { component: 'tax-tracker' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WinSummary {
  id: string;
  contestId: string;
  prizeDescription: string | null;
  prizeValue: number;
  claimStatus: string;
  detectedAt: string;
}

export interface TaxReport {
  profileId: string;
  year: number;
  totalValue: number;
  wins: WinSummary[];
  needsReporting: boolean;
  formattedTotal: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IRS threshold for 1099-MISC reporting on prize winnings. */
const IRS_REPORTING_THRESHOLD = 600;

// ---------------------------------------------------------------------------
// TaxTracker
// ---------------------------------------------------------------------------

export class TaxTracker {
  private readonly db: BetterSQLite3Database;

  constructor(db: BetterSQLite3Database) {
    this.db = db;
  }

  /**
   * Returns the total value of all prizes won by a profile in a given
   * tax year. Defaults to the current year.
   */
  async getTotalWinnings(
    profileId: string,
    year?: number,
  ): Promise<number> {
    const targetYear = year ?? new Date().getFullYear();
    const yearStart = `${targetYear}-01-01T00:00:00.000Z`;
    const yearEnd = `${targetYear + 1}-01-01T00:00:00.000Z`;

    const rows = this.db
      .select({
        total: sql<number>`COALESCE(SUM(${wins.prizeValue}), 0)`,
      })
      .from(wins)
      .where(
        and(
          eq(wins.profileId, profileId),
          sql`${wins.createdAt} >= ${yearStart}`,
          sql`${wins.createdAt} < ${yearEnd}`,
        ),
      )
      .all();

    const total = rows[0]?.total ?? 0;

    logger.debug(
      { profileId, year: targetYear, total },
      'Retrieved total winnings',
    );

    return total;
  }

  /**
   * Checks whether a profile's total winnings for the current year
   * exceed the IRS 1099-MISC reporting threshold ($600).
   */
  async needsReporting(profileId: string): Promise<boolean> {
    const total = await this.getTotalWinnings(profileId);
    const needed = total >= IRS_REPORTING_THRESHOLD;

    if (needed) {
      logger.info(
        {
          profileId,
          total,
          threshold: IRS_REPORTING_THRESHOLD,
        },
        'Profile winnings exceed tax reporting threshold',
      );
    }

    return needed;
  }

  /**
   * Generates a tax report for a profile for a given year, listing
   * all individual wins and the aggregate total.
   */
  async getReport(profileId: string, year: number): Promise<TaxReport> {
    const yearStart = `${year}-01-01T00:00:00.000Z`;
    const yearEnd = `${year + 1}-01-01T00:00:00.000Z`;

    const winRows = this.db
      .select()
      .from(wins)
      .where(
        and(
          eq(wins.profileId, profileId),
          sql`${wins.createdAt} >= ${yearStart}`,
          sql`${wins.createdAt} < ${yearEnd}`,
        ),
      )
      .all();

    const winSummaries: WinSummary[] = winRows.map((row) => ({
      id: row.id,
      contestId: row.contestId,
      prizeDescription: row.prizeDescription,
      prizeValue: row.prizeValue ?? 0,
      claimStatus: row.claimStatus,
      detectedAt: row.createdAt,
    }));

    const totalValue = winSummaries.reduce(
      (sum, w) => sum + w.prizeValue,
      0,
    );

    const report: TaxReport = {
      profileId,
      year,
      totalValue,
      wins: winSummaries,
      needsReporting: totalValue >= IRS_REPORTING_THRESHOLD,
      formattedTotal: formatCurrency(totalValue),
    };

    logger.info(
      {
        profileId,
        year,
        totalValue,
        winCount: winSummaries.length,
        needsReporting: report.needsReporting,
      },
      'Tax report generated',
    );

    return report;
  }
}
