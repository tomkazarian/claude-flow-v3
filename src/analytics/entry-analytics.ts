/**
 * Entry success/failure rate analytics.
 * Provides domain-level, type-level, and time-series breakdowns.
 */

import { and, gte, lte, sql, count, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { entries, contests } from '../db/schema.js';
import { getLogger } from '../shared/logger.js';
import type {
  DateRange,
  DomainStats,
  FailureReason,
  TimeSeriesPoint,
} from './types.js';

const log = getLogger('analytics', { service: 'entry-analytics' });

/**
 * Maps a granularity string to a SQLite strftime format for time bucketing.
 */
function timeBucketFormat(granularity: 'hour' | 'day' | 'week'): string {
  switch (granularity) {
    case 'hour':
      return '%Y-%m-%dT%H:00:00Z';
    case 'day':
      return '%Y-%m-%dT00:00:00Z';
    case 'week':
      // SQLite does not have a native ISO week function; we approximate
      // by grouping on year + day-of-year floored to 7-day blocks.
      return '%Y-W%W';
  }
}

export class EntryAnalytics {
  /**
   * Returns success rate per domain, ordered by total entries descending.
   */
  async getSuccessRateByDomain(limit = 20): Promise<DomainStats[]> {
    const db = getDb();

    try {
      // Extract domain from contest URL using SQLite string functions.
      // We strip the protocol and path to get the bare domain.
      const rows = db
        .select({
          domain: sql<string>`
            replace(
              replace(
                replace(
                  substr(${contests.url}, instr(${contests.url}, '://') + 3),
                  'www.', ''
                ),
                substr(
                  substr(${contests.url}, instr(${contests.url}, '://') + 3),
                  instr(
                    substr(${contests.url}, instr(${contests.url}, '://') + 3),
                    '/'
                  )
                ),
                ''
              ),
              'www.', ''
            )`.as('domain'),
          total: count(),
          successful: sql<number>`sum(case when ${entries.status} in ('submitted','confirmed','won') then 1 else 0 end)`,
          failed: sql<number>`sum(case when ${entries.status} = 'failed' then 1 else 0 end)`,
        })
        .from(entries)
        .innerJoin(contests, eq(entries.contestId, contests.id))
        .groupBy(sql`domain`)
        .orderBy(sql`count(*) desc`)
        .limit(limit)
        .all();

      return rows.map((row) => ({
        domain: row.domain || 'unknown',
        total: row.total,
        successful: row.successful,
        failed: row.failed,
        successRate: row.total > 0 ? row.successful / row.total : 0,
      }));
    } catch (error) {
      log.error({ err: error }, 'Failed to get success rate by domain');
      return [];
    }
  }

  /**
   * Returns success rate grouped by contest type.
   */
  async getSuccessRateByType(): Promise<Record<string, number>> {
    const db = getDb();

    try {
      const rows = db
        .select({
          contestType: contests.type,
          total: count(),
          successful: sql<number>`sum(case when ${entries.status} in ('submitted','confirmed','won') then 1 else 0 end)`,
        })
        .from(entries)
        .innerJoin(contests, eq(entries.contestId, contests.id))
        .groupBy(contests.type)
        .all();

      const result: Record<string, number> = {};
      for (const row of rows) {
        result[row.contestType] = row.total > 0 ? row.successful / row.total : 0;
      }
      return result;
    } catch (error) {
      log.error({ err: error }, 'Failed to get success rate by type');
      return {};
    }
  }

  /**
   * Returns success rate over time as a time-series.
   */
  async getSuccessRateOverTime(
    period: DateRange,
    granularity: 'hour' | 'day' | 'week',
  ): Promise<TimeSeriesPoint[]> {
    const db = getDb();
    const bucket = timeBucketFormat(granularity);

    try {
      const rows = db
        .select({
          bucket: sql<string>`strftime('${sql.raw(bucket)}', ${entries.createdAt})`.as('bucket'),
          total: count(),
          successful: sql<number>`sum(case when ${entries.status} in ('submitted','confirmed','won') then 1 else 0 end)`,
        })
        .from(entries)
        .where(
          and(
            gte(entries.createdAt, period.from),
            lte(entries.createdAt, period.to),
          ),
        )
        .groupBy(sql`bucket`)
        .orderBy(sql`bucket asc`)
        .all();

      return rows.map((row) => ({
        timestamp: row.bucket,
        value: row.total > 0 ? row.successful / row.total : 0,
        label: `${row.successful}/${row.total}`,
      }));
    } catch (error) {
      log.error({ err: error, period, granularity }, 'Failed to get success rate over time');
      return [];
    }
  }

  /**
   * Returns the most common failure reasons.
   */
  async getFailureReasons(limit = 10): Promise<FailureReason[]> {
    const db = getDb();

    try {
      // Count total failed entries for percentage calculation
      const totalResult = db
        .select({ cnt: count() })
        .from(entries)
        .where(eq(entries.status, 'failed'))
        .get();

      const totalFailed = totalResult?.cnt ?? 0;

      if (totalFailed === 0) {
        return [];
      }

      const rows = db
        .select({
          reason: sql<string>`coalesce(${entries.errorMessage}, 'Unknown error')`.as('reason'),
          cnt: count(),
        })
        .from(entries)
        .where(eq(entries.status, 'failed'))
        .groupBy(sql`reason`)
        .orderBy(sql`count(*) desc`)
        .limit(limit)
        .all();

      return rows.map((row) => ({
        reason: row.reason,
        count: row.cnt,
        percentage: totalFailed > 0 ? row.cnt / totalFailed : 0,
      }));
    } catch (error) {
      log.error({ err: error }, 'Failed to get failure reasons');
      return [];
    }
  }

  /**
   * Returns the average entry duration in milliseconds across all completed entries.
   */
  async getAverageEntryDuration(): Promise<number> {
    const db = getDb();

    try {
      const result = db
        .select({
          avg: sql<number>`coalesce(avg(${entries.durationMs}), 0)`,
        })
        .from(entries)
        .where(sql`${entries.durationMs} is not null`)
        .get();

      return result?.avg ?? 0;
    } catch (error) {
      log.error({ err: error }, 'Failed to get average entry duration');
      return 0;
    }
  }
}
