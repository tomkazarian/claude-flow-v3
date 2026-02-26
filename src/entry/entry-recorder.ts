/**
 * Entry recorder - persists entry results and tracks entry limits
 * using the real SQLite database via Drizzle ORM.
 *
 * Records entry attempts, updates statuses, and enforces per-contest
 * entry frequency limits. All data is durably written to the
 * `entries` and `entry_limits` tables.
 */

import { eq, and } from 'drizzle-orm';
import { getLogger } from '../shared/logger.js';
import { generateId } from '../shared/crypto.js';
import { getDb } from '../db/index.js';
import { entries, entryLimits } from '../db/schema.js';
import type { EntryStatus } from '../shared/constants.js';
import type { EntryResult, EntryRecord, EntryLimitRecord } from './types.js';

const log = getLogger('entry', { component: 'entry-recorder' });

// ---------------------------------------------------------------------------
// Database enum mapping
// ---------------------------------------------------------------------------

/**
 * The DB schema's `entries.status` column accepts a narrower set of values
 * than the application-level EntryStatus enum. This map converts application
 * statuses to the closest DB-level equivalent so inserts never violate the
 * column constraint.
 */
type DbEntryStatus = 'pending' | 'submitted' | 'confirmed' | 'failed' | 'won' | 'lost' | 'expired' | 'duplicate';

function toDbStatus(status: string): DbEntryStatus {
  const mapping: Record<string, DbEntryStatus> = {
    pending: 'pending',
    queued: 'pending',
    in_progress: 'pending',
    submitted: 'submitted',
    confirmed: 'confirmed',
    failed: 'failed',
    skipped: 'failed',
    duplicate: 'duplicate',
    won: 'won',
    lost: 'lost',
    expired: 'expired',
  };
  return mapping[status] ?? 'pending';
}

/**
 * Entry frequency to millisecond mapping for determining next eligible date.
 */
const FREQUENCY_INTERVALS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  once: Infinity,
  unlimited: 0,
};

export class EntryRecorder {
  /**
   * Record a completed entry attempt.
   * Inserts a row into the `entries` table.
   * Returns the entry ID.
   */
  async record(result: EntryResult): Promise<string> {
    const id = result.entryId || generateId();
    const now = new Date().toISOString();

    try {
      const db = getDb();

      const dbStatus = toDbStatus(result.status);

      db.insert(entries).values({
        id,
        contestId: result.contestId,
        profileId: result.profileId,
        status: dbStatus,
        errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
        screenshotPath: result.screenshotPath ?? null,
        durationMs: result.durationMs,
        submittedAt: dbStatus === 'confirmed' || dbStatus === 'submitted' ? now : null,
        confirmedAt: dbStatus === 'confirmed' ? now : null,
        createdAt: now,
        updatedAt: now,
      }).run();

      log.info(
        {
          entryId: id,
          contestId: result.contestId,
          profileId: result.profileId,
          status: result.status,
        },
        'Entry recorded to database',
      );
    } catch (error) {
      // If the database write fails (e.g. foreign-key violation because
      // the contest/profile does not exist yet), log and fall through
      // so the orchestrator still gets a valid entry ID.
      log.error(
        {
          entryId: id,
          contestId: result.contestId,
          profileId: result.profileId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to record entry to database, entry data may be lost',
      );
    }

    return id;
  }

  /**
   * Update the status of an existing entry.
   */
  async updateStatus(
    entryId: string,
    status: EntryStatus,
    details?: Partial<EntryRecord>,
  ): Promise<void> {
    try {
      const db = getDb();
      const now = new Date().toISOString();

      const dbStatus = toDbStatus(status);

      const updateValues: Record<string, unknown> = {
        status: dbStatus,
        updatedAt: now,
      };

      if (details?.message !== undefined) {
        updateValues.errorMessage = details.message;
      }
      if (details?.screenshotPath !== undefined) {
        updateValues.screenshotPath = details.screenshotPath;
      }
      if (dbStatus === 'confirmed') {
        updateValues.confirmedAt = now;
      }

      db.update(entries)
        .set(updateValues)
        .where(eq(entries.id, entryId))
        .run();

      log.debug({ entryId, status }, 'Entry status updated in database');
    } catch (error) {
      log.error(
        { entryId, status, error: error instanceof Error ? error.message : String(error) },
        'Failed to update entry status in database',
      );
    }
  }

  /**
   * Update the entry limit counter after a successful entry.
   * Uses an UPSERT to atomically create or increment the limit record.
   */
  async updateEntryLimit(
    contestId: string,
    profileId: string,
    entryFrequency: string = 'once',
  ): Promise<void> {
    const now = new Date().toISOString();
    const intervalMs = FREQUENCY_INTERVALS[entryFrequency] ?? FREQUENCY_INTERVALS['once']!;
    const nextEligible = intervalMs === Infinity
      ? null
      : intervalMs === 0
        ? now
        : new Date(Date.now() + intervalMs).toISOString();

    try {
      const db = getDb();

      // Check if a limit record already exists
      const existing = db
        .select()
        .from(entryLimits)
        .where(
          and(
            eq(entryLimits.contestId, contestId),
            eq(entryLimits.profileId, profileId),
          ),
        )
        .get();

      if (existing) {
        db.update(entryLimits)
          .set({
            entryCount: existing.entryCount + 1,
            lastEntryAt: now,
            nextEligibleAt: nextEligible,
          })
          .where(eq(entryLimits.id, existing.id))
          .run();
      } else {
        db.insert(entryLimits).values({
          id: generateId(),
          contestId,
          profileId,
          entryCount: 1,
          lastEntryAt: now,
          nextEligibleAt: nextEligible,
        }).run();
      }

      log.debug(
        { contestId, profileId, entryFrequency, nextEligible },
        'Entry limit updated in database',
      );
    } catch (error) {
      log.error(
        {
          contestId, profileId, entryFrequency,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to update entry limit in database',
      );
    }
  }

  /**
   * Check whether a profile can enter a contest based on frequency limits.
   * Returns true if the profile is eligible to enter.
   */
  async checkEntryLimit(contestId: string, profileId: string): Promise<boolean> {
    try {
      const db = getDb();

      const limit = db
        .select()
        .from(entryLimits)
        .where(
          and(
            eq(entryLimits.contestId, contestId),
            eq(entryLimits.profileId, profileId),
          ),
        )
        .get();

      if (!limit) {
        // Never entered before; eligible
        return true;
      }

      if (limit.nextEligibleAt === null) {
        // One-time entry, already entered
        return false;
      }

      const now = new Date();
      const nextEligible = new Date(limit.nextEligibleAt);

      if (now >= nextEligible) {
        return true;
      }

      log.debug(
        { contestId, profileId, nextEligibleAt: limit.nextEligibleAt },
        'Entry limit not yet cleared',
      );

      return false;
    } catch (error) {
      // If we cannot check the database, allow the entry to proceed
      // rather than silently blocking legitimate entries.
      log.error(
        {
          contestId, profileId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to check entry limit, allowing entry to proceed',
      );
      return true;
    }
  }

  /**
   * Retrieve an entry record by ID.
   */
  async getEntry(entryId: string): Promise<EntryRecord | null> {
    try {
      const db = getDb();

      const row = db
        .select()
        .from(entries)
        .where(eq(entries.id, entryId))
        .get();

      if (!row) return null;

      return this.rowToRecord(row);
    } catch (error) {
      log.error(
        { entryId, error: error instanceof Error ? error.message : String(error) },
        'Failed to retrieve entry from database',
      );
      return null;
    }
  }

  /**
   * Retrieve all entries for a contest.
   */
  async getEntriesForContest(contestId: string): Promise<EntryRecord[]> {
    try {
      const db = getDb();

      const rows = db
        .select()
        .from(entries)
        .where(eq(entries.contestId, contestId))
        .all();

      return rows.map(row => this.rowToRecord(row));
    } catch (error) {
      log.error(
        { contestId, error: error instanceof Error ? error.message : String(error) },
        'Failed to retrieve entries for contest',
      );
      return [];
    }
  }

  /**
   * Retrieve all entries for a profile.
   */
  async getEntriesForProfile(profileId: string): Promise<EntryRecord[]> {
    try {
      const db = getDb();

      const rows = db
        .select()
        .from(entries)
        .where(eq(entries.profileId, profileId))
        .all();

      return rows.map(row => this.rowToRecord(row));
    } catch (error) {
      log.error(
        { profileId, error: error instanceof Error ? error.message : String(error) },
        'Failed to retrieve entries for profile',
      );
      return [];
    }
  }

  /**
   * Get the entry limit record for a contest-profile pair.
   */
  async getEntryLimit(contestId: string, profileId: string): Promise<EntryLimitRecord | null> {
    try {
      const db = getDb();

      const row = db
        .select()
        .from(entryLimits)
        .where(
          and(
            eq(entryLimits.contestId, contestId),
            eq(entryLimits.profileId, profileId),
          ),
        )
        .get();

      if (!row) return null;

      return {
        contestId: row.contestId,
        profileId: row.profileId,
        entryCount: row.entryCount,
        lastEnteredAt: row.lastEntryAt ?? '',
        nextEligibleAt: row.nextEligibleAt,
      };
    } catch (error) {
      log.error(
        {
          contestId, profileId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to retrieve entry limit',
      );
      return null;
    }
  }

  /**
   * Get the total number of recorded entries.
   */
  getEntryCount(): number {
    try {
      const db = getDb();

      const result = db
        .select()
        .from(entries)
        .all();

      return result.length;
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to count entries',
      );
      return 0;
    }
  }

  /**
   * Convert a database row to an EntryRecord.
   */
  private rowToRecord(row: typeof entries.$inferSelect): EntryRecord {
    return {
      id: row.id,
      contestId: row.contestId,
      profileId: row.profileId,
      status: row.status as EntryStatus,
      message: row.errorMessage ?? '',
      confirmationNumber: undefined,
      screenshotPath: row.screenshotPath ?? undefined,
      durationMs: row.durationMs ?? 0,
      errors: row.errorMessage ? row.errorMessage.split('; ') : [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
