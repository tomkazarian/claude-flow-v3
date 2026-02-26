/**
 * Entry frequency and limit enforcement.
 *
 * Tracks how many times each profile has entered each contest, computes
 * when the next entry is eligible, and enforces maximum entry counts.
 * Uses the entry_limits table for persistence.
 */

import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getLogger } from '../shared/logger.js';
import { generateId } from '../shared/crypto.js';
import { entryLimits, contests } from '../db/schema.js';

const logger = getLogger('compliance', { component: 'entry-limiter' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntryFrequency = 'once' | 'daily' | 'weekly' | 'unlimited';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum delay between "unlimited" entries to avoid detection (5 minutes). */
const UNLIMITED_RATE_LIMIT_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// EntryLimiter
// ---------------------------------------------------------------------------

export class EntryLimiter {
  private readonly db: BetterSQLite3Database;

  constructor(db: BetterSQLite3Database) {
    this.db = db;
  }

  /**
   * Checks whether a profile can enter a specific contest right now.
   *
   * Evaluates:
   * - Whether the entry count has reached the contest's maxEntries
   * - Whether enough time has elapsed since the last entry based on
   *   the contest's entry_frequency
   *
   * @returns true if the profile may submit a new entry
   */
  async canEnter(contestId: string, profileId: string): Promise<boolean> {
    // Get the contest for frequency/max entries configuration
    const contestRows = this.db
      .select()
      .from(contests)
      .where(eq(contests.id, contestId))
      .limit(1)
      .all();

    const contest = contestRows[0];
    if (!contest) {
      logger.warn({ contestId }, 'Contest not found for entry limit check');
      return false;
    }

    // Get existing entry limit record
    const limitRows = this.db
      .select()
      .from(entryLimits)
      .where(
        and(
          eq(entryLimits.contestId, contestId),
          eq(entryLimits.profileId, profileId),
        ),
      )
      .limit(1)
      .all();

    const limit = limitRows[0];

    // No prior entries - always eligible
    if (!limit) {
      logger.debug(
        { contestId, profileId },
        'No prior entries, profile is eligible',
      );
      return true;
    }

    // Check max entries
    if (contest.maxEntries && limit.entryCount >= contest.maxEntries) {
      logger.debug(
        {
          contestId,
          profileId,
          entryCount: limit.entryCount,
          maxEntries: contest.maxEntries,
        },
        'Profile has reached max entries for contest',
      );
      return false;
    }

    // Check frequency-based eligibility
    const frequency = (contest.entryFrequency ?? 'once') as EntryFrequency;

    if (frequency === 'once') {
      // Already entered at least once
      logger.debug(
        { contestId, profileId },
        'Contest is once-only and profile has already entered',
      );
      return false;
    }

    // Check next eligible time
    if (limit.nextEligibleAt) {
      const nextEligible = new Date(limit.nextEligibleAt);
      if (nextEligible.getTime() > Date.now()) {
        logger.debug(
          {
            contestId,
            profileId,
            nextEligibleAt: limit.nextEligibleAt,
          },
          'Profile is not yet eligible for next entry',
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Records that a profile has submitted an entry to a contest.
   * Updates the entry count and computes the next eligible entry time.
   */
  async recordEntry(contestId: string, profileId: string): Promise<void> {
    const now = new Date().toISOString();

    // Get contest frequency configuration
    const contestRows = this.db
      .select()
      .from(contests)
      .where(eq(contests.id, contestId))
      .limit(1)
      .all();

    const contest = contestRows[0];
    const frequency = (contest?.entryFrequency ?? 'once') as EntryFrequency;
    const nextEligibleAt = this.computeNextEligible(frequency);

    // Check for existing record
    const existingRows = this.db
      .select()
      .from(entryLimits)
      .where(
        and(
          eq(entryLimits.contestId, contestId),
          eq(entryLimits.profileId, profileId),
        ),
      )
      .limit(1)
      .all();

    const existing = existingRows[0];

    if (existing) {
      // Update existing record
      this.db
        .update(entryLimits)
        .set({
          entryCount: existing.entryCount + 1,
          lastEntryAt: now,
          nextEligibleAt,
        })
        .where(eq(entryLimits.id, existing.id))
        .run();

      logger.debug(
        {
          contestId,
          profileId,
          entryCount: existing.entryCount + 1,
          nextEligibleAt,
        },
        'Entry limit record updated',
      );
    } else {
      // Create new record
      this.db
        .insert(entryLimits)
        .values({
          id: generateId(),
          contestId,
          profileId,
          entryCount: 1,
          lastEntryAt: now,
          nextEligibleAt,
        })
        .run();

      logger.debug(
        { contestId, profileId, nextEligibleAt },
        'Entry limit record created',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Computes the next_eligible_at timestamp based on the entry frequency.
   */
  private computeNextEligible(frequency: EntryFrequency): string | null {
    const now = new Date();

    switch (frequency) {
      case 'once':
        // Never eligible again - return a far-future date
        return new Date('2099-12-31T23:59:59.999Z').toISOString();

      case 'daily': {
        // Tomorrow at midnight UTC
        const tomorrow = new Date(now);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        tomorrow.setUTCHours(0, 0, 0, 0);
        return tomorrow.toISOString();
      }

      case 'weekly': {
        // Next week, same day, at midnight UTC
        const nextWeek = new Date(now);
        nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
        nextWeek.setUTCHours(0, 0, 0, 0);
        return nextWeek.toISOString();
      }

      case 'unlimited': {
        // Rate-limited to prevent detection
        const nextEligible = new Date(
          now.getTime() + UNLIMITED_RATE_LIMIT_MS,
        );
        return nextEligible.toISOString();
      }

      default:
        return null;
    }
  }
}
