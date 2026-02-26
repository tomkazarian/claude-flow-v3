/**
 * Time-series data storage and querying.
 * Uses a dedicated metrics table for recording arbitrary named metrics
 * and supports time-bucketed aggregation queries.
 */

import { and, gte, lte, eq, sql, desc } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  real,
  index,
} from 'drizzle-orm/sqlite-core';
import { getDb, getSqlite } from '../db/index.js';
import { getLogger } from '../shared/logger.js';
import { generateId } from '../shared/crypto.js';
import type { DateRange, TimeSeriesPoint } from './types.js';

const log = getLogger('analytics', { service: 'time-series' });

// ---------------------------------------------------------------------------
// Schema for the time_series_metrics table
// ---------------------------------------------------------------------------

const currentTimestamp = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const timeSeriesMetrics = sqliteTable(
  'time_series_metrics',
  {
    id: text('id').primaryKey(),
    metric: text('metric').notNull(),
    value: real('value').notNull(),
    timestamp: text('timestamp').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_tsm_metric_ts').on(table.metric, table.timestamp),
  ],
);

// ---------------------------------------------------------------------------
// TimeSeriesStore
// ---------------------------------------------------------------------------

export class TimeSeriesStore {
  private tableEnsured = false;

  /**
   * Ensures the time_series_metrics table exists.
   * Called lazily on first operation.
   */
  private ensureTable(): void {
    if (this.tableEnsured) {
      return;
    }

    try {
      const sqlite = getSqlite();
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS time_series_metrics (
          id TEXT PRIMARY KEY,
          metric TEXT NOT NULL,
          value REAL NOT NULL,
          timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tsm_metric_ts
          ON time_series_metrics(metric, timestamp);
      `);
      this.tableEnsured = true;
    } catch (error) {
      log.error({ err: error }, 'Failed to ensure time_series_metrics table');
      throw error;
    }
  }

  /**
   * Records a data point for a named metric.
   *
   * @param metric - The metric name (e.g., 'entry.success_rate', 'cost.daily')
   * @param value - The numeric value
   * @param timestamp - ISO-8601 timestamp; defaults to current time
   */
  async record(
    metric: string,
    value: number,
    timestamp?: string,
  ): Promise<void> {
    this.ensureTable();
    const db = getDb();

    try {
      db.insert(timeSeriesMetrics)
        .values({
          id: generateId(),
          metric,
          value,
          timestamp: timestamp ?? new Date().toISOString(),
        })
        .run();

      log.debug({ metric, value }, 'Time series point recorded');
    } catch (error) {
      log.error({ err: error, metric, value }, 'Failed to record time series point');
      throw error;
    }
  }

  /**
   * Queries time-series data for a metric with aggregation.
   * Returns data points grouped by time bucket with averaged values.
   *
   * @param metric - The metric name to query
   * @param period - Date range to query
   * @param granularity - Time bucket size
   */
  async query(
    metric: string,
    period: DateRange,
    granularity: 'minute' | 'hour' | 'day' | 'week',
  ): Promise<TimeSeriesPoint[]> {
    this.ensureTable();
    const db = getDb();

    let bucketFormat: string;
    switch (granularity) {
      case 'minute':
        bucketFormat = '%Y-%m-%dT%H:%M:00Z';
        break;
      case 'hour':
        bucketFormat = '%Y-%m-%dT%H:00:00Z';
        break;
      case 'day':
        bucketFormat = '%Y-%m-%dT00:00:00Z';
        break;
      case 'week':
        bucketFormat = '%Y-W%W';
        break;
    }

    try {
      const rows = db
        .select({
          bucket: sql<string>`strftime('${sql.raw(bucketFormat)}', ${timeSeriesMetrics.timestamp})`.as('bucket'),
          avgValue: sql<number>`avg(${timeSeriesMetrics.value})`,
          minValue: sql<number>`min(${timeSeriesMetrics.value})`,
          maxValue: sql<number>`max(${timeSeriesMetrics.value})`,
          pointCount: sql<number>`count(*)`,
        })
        .from(timeSeriesMetrics)
        .where(
          and(
            eq(timeSeriesMetrics.metric, metric),
            gte(timeSeriesMetrics.timestamp, period.from),
            lte(timeSeriesMetrics.timestamp, period.to),
          ),
        )
        .groupBy(sql`bucket`)
        .orderBy(sql`bucket asc`)
        .all();

      return rows.map((row) => ({
        timestamp: row.bucket,
        value: row.avgValue,
        label: `avg=${row.avgValue.toFixed(2)} min=${row.minValue.toFixed(2)} max=${row.maxValue.toFixed(2)} n=${row.pointCount}`,
      }));
    } catch (error) {
      log.error({ err: error, metric, period, granularity }, 'Failed to query time series');
      return [];
    }
  }

  /**
   * Returns the most recent data point for a given metric.
   * Returns null if no data exists.
   */
  async getLatest(metric: string): Promise<TimeSeriesPoint | null> {
    this.ensureTable();
    const db = getDb();

    try {
      const row = db
        .select({
          timestamp: timeSeriesMetrics.timestamp,
          value: timeSeriesMetrics.value,
        })
        .from(timeSeriesMetrics)
        .where(eq(timeSeriesMetrics.metric, metric))
        .orderBy(desc(timeSeriesMetrics.timestamp))
        .limit(1)
        .get();

      if (!row) {
        return null;
      }

      return {
        timestamp: row.timestamp,
        value: row.value,
      };
    } catch (error) {
      log.error({ err: error, metric }, 'Failed to get latest time series point');
      return null;
    }
  }
}
