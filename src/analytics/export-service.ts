/**
 * CSV and JSON data export service.
 * Generates export files from database queries and saves them to data/exports/.
 */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, gte, lte, eq, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { entries, contests, wins, costLog, profiles } from '../db/schema.js';
import { getLogger } from '../shared/logger.js';
import { generateId } from '../shared/crypto.js';
import type {
  DateRange,
  EntryFilter,
  ContestFilter,
  WinFilter,
} from './types.js';

const log = getLogger('analytics', { service: 'export' });

// Resolve export directory relative to the project root (two levels up from
// src/analytics/), not the process cwd which may vary at runtime.
const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = resolve(__dirname, '../../data/exports');

/**
 * Ensures the exports directory exists.
 */
function ensureExportDir(): void {
  if (!existsSync(EXPORT_DIR)) {
    mkdirSync(EXPORT_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// CSV helpers (no external dependency)
// ---------------------------------------------------------------------------

/**
 * Escapes a single CSV field value following RFC 4180.
 * - If the value contains commas, double quotes, or newlines, it is quoted.
 * - Double quotes within the value are escaped by doubling them.
 */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  if (
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Converts an array of objects to a CSV string.
 */
function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) {
    return '';
  }

  const headers = columns ?? Object.keys(rows[0] as Record<string, unknown>);
  const headerLine = headers.map(escapeCsvField).join(',');

  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCsvField(row[h])).join(','),
  );

  return [headerLine, ...dataLines].join('\n');
}

/**
 * Writes export content to a file and returns the file path.
 */
function writeExport(
  name: string,
  content: string,
  format: 'csv' | 'json',
): string {
  ensureExportDir();

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const filename = `${name}_${timestamp}_${generateId().slice(-6)}.${format}`;
  const filePath = resolve(EXPORT_DIR, filename);

  writeFileSync(filePath, content, 'utf-8');
  log.info({ filePath, format, name }, 'Export file written');

  return filePath;
}

// ---------------------------------------------------------------------------
// Export service
// ---------------------------------------------------------------------------

export class ExportService {
  /**
   * Exports entry data matching the filter.
   * Returns the path to the generated file.
   */
  async exportEntries(
    filter: EntryFilter,
    format: 'csv' | 'json',
  ): Promise<string> {
    const db = getDb();

    try {
      const conditions = [];

      if (filter.contestId) {
        conditions.push(eq(entries.contestId, filter.contestId));
      }
      if (filter.profileId) {
        conditions.push(eq(entries.profileId, filter.profileId));
      }
      if (filter.status) {
        conditions.push(eq(entries.status, filter.status as typeof entries.status._.data));
      }
      if (filter.from) {
        conditions.push(gte(entries.createdAt, filter.from));
      }
      if (filter.to) {
        conditions.push(lte(entries.createdAt, filter.to));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = db
        .select({
          id: entries.id,
          contestId: entries.contestId,
          contestTitle: contests.title,
          profileId: entries.profileId,
          status: entries.status,
          entryMethod: entries.entryMethod,
          captchaSolved: entries.captchaSolved,
          emailConfirmed: entries.emailConfirmed,
          smsVerified: entries.smsVerified,
          durationMs: entries.durationMs,
          errorMessage: entries.errorMessage,
          submittedAt: entries.submittedAt,
          confirmedAt: entries.confirmedAt,
          createdAt: entries.createdAt,
        })
        .from(entries)
        .leftJoin(contests, eq(entries.contestId, contests.id))
        .where(whereClause)
        .orderBy(sql`${entries.createdAt} desc`)
        .all();

      const content =
        format === 'csv'
          ? toCsv(rows as unknown as Record<string, unknown>[])
          : JSON.stringify(rows, null, 2);

      return writeExport('entries', content, format);
    } catch (error) {
      log.error({ err: error, filter, format }, 'Failed to export entries');
      throw error;
    }
  }

  /**
   * Exports contest data matching the filter.
   * Returns the path to the generated file.
   */
  async exportContests(
    filter: ContestFilter,
    format: 'csv' | 'json',
  ): Promise<string> {
    const db = getDb();

    try {
      const conditions = [];

      if (filter.type) {
        conditions.push(eq(contests.type, filter.type as typeof contests.type._.data));
      }
      if (filter.status) {
        conditions.push(eq(contests.status, filter.status as typeof contests.status._.data));
      }
      if (filter.source) {
        conditions.push(eq(contests.source, filter.source));
      }
      if (filter.from) {
        conditions.push(gte(contests.createdAt, filter.from));
      }
      if (filter.to) {
        conditions.push(lte(contests.createdAt, filter.to));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = db
        .select({
          id: contests.id,
          title: contests.title,
          url: contests.url,
          sponsor: contests.sponsor,
          type: contests.type,
          entryMethod: contests.entryMethod,
          status: contests.status,
          source: contests.source,
          startDate: contests.startDate,
          endDate: contests.endDate,
          prizeDescription: contests.prizeDescription,
          prizeValue: contests.prizeValue,
          prizeCategory: contests.prizeCategory,
          entryFrequency: contests.entryFrequency,
          requiresCaptcha: contests.requiresCaptcha,
          legitimacyScore: contests.legitimacyScore,
          priorityScore: contests.priorityScore,
          createdAt: contests.createdAt,
        })
        .from(contests)
        .where(whereClause)
        .orderBy(sql`${contests.createdAt} desc`)
        .all();

      const content =
        format === 'csv'
          ? toCsv(rows as unknown as Record<string, unknown>[])
          : JSON.stringify(rows, null, 2);

      return writeExport('contests', content, format);
    } catch (error) {
      log.error({ err: error, filter, format }, 'Failed to export contests');
      throw error;
    }
  }

  /**
   * Exports win data matching the filter.
   * Returns the path to the generated file.
   */
  async exportWins(
    filter: WinFilter,
    format: 'csv' | 'json',
  ): Promise<string> {
    const db = getDb();

    try {
      const conditions = [];

      if (filter.profileId) {
        conditions.push(eq(wins.profileId, filter.profileId));
      }
      if (filter.claimStatus) {
        conditions.push(eq(wins.claimStatus, filter.claimStatus as typeof wins.claimStatus._.data));
      }
      if (filter.from) {
        conditions.push(gte(wins.createdAt, filter.from));
      }
      if (filter.to) {
        conditions.push(lte(wins.createdAt, filter.to));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = db
        .select({
          id: wins.id,
          entryId: wins.entryId,
          contestId: wins.contestId,
          contestTitle: contests.title,
          profileId: wins.profileId,
          profileName: sql<string>`${profiles.firstName} || ' ' || ${profiles.lastName}`,
          prizeDescription: wins.prizeDescription,
          prizeValue: wins.prizeValue,
          detectionSource: wins.detectionSource,
          claimDeadline: wins.claimDeadline,
          claimStatus: wins.claimStatus,
          claimUrl: wins.claimUrl,
          taxReported: wins.taxReported,
          createdAt: wins.createdAt,
        })
        .from(wins)
        .leftJoin(contests, eq(wins.contestId, contests.id))
        .leftJoin(profiles, eq(wins.profileId, profiles.id))
        .where(whereClause)
        .orderBy(sql`${wins.createdAt} desc`)
        .all();

      const content =
        format === 'csv'
          ? toCsv(rows as unknown as Record<string, unknown>[])
          : JSON.stringify(rows, null, 2);

      return writeExport('wins', content, format);
    } catch (error) {
      log.error({ err: error, filter, format }, 'Failed to export wins');
      throw error;
    }
  }

  /**
   * Exports cost log data for a given period.
   * Returns the path to the generated file.
   */
  async exportCosts(
    period: DateRange,
    format: 'csv' | 'json',
  ): Promise<string> {
    const db = getDb();

    try {
      const rows = db
        .select({
          id: costLog.id,
          category: costLog.category,
          provider: costLog.provider,
          amount: costLog.amount,
          currency: costLog.currency,
          entryId: costLog.entryId,
          description: costLog.description,
          createdAt: costLog.createdAt,
        })
        .from(costLog)
        .where(
          and(
            gte(costLog.createdAt, period.from),
            lte(costLog.createdAt, period.to),
          ),
        )
        .orderBy(sql`${costLog.createdAt} desc`)
        .all();

      const content =
        format === 'csv'
          ? toCsv(rows as unknown as Record<string, unknown>[])
          : JSON.stringify(rows, null, 2);

      return writeExport('costs', content, format);
    } catch (error) {
      log.error({ err: error, period, format }, 'Failed to export costs');
      throw error;
    }
  }
}
