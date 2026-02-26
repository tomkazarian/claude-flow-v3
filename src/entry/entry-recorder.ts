/**
 * Entry recorder - persists entry results and tracks entry limits.
 *
 * Provides in-memory storage with a database-compatible interface.
 * Records entry attempts, updates statuses, and enforces per-contest
 * entry frequency limits.
 */

import { getLogger } from '../shared/logger.js';
import { generateId } from '../shared/crypto.js';
import type { EntryStatus } from '../shared/constants.js';
import type { EntryResult, EntryRecord, EntryLimitRecord } from './types.js';

const log = getLogger('entry', { component: 'entry-recorder' });

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
  /** In-memory entry records store. Keyed by entry ID. */
  private readonly entries = new Map<string, EntryRecord>();

  /** In-memory entry limit tracking. Keyed by "contestId:profileId". */
  private readonly entryLimits = new Map<string, EntryLimitRecord>();

  /**
   * Record a completed entry attempt.
   * Returns the entry ID.
   */
  async record(result: EntryResult): Promise<string> {
    const id = result.entryId || generateId();
    const now = new Date().toISOString();

    const record: EntryRecord = {
      id,
      contestId: result.contestId,
      profileId: result.profileId,
      status: result.status,
      message: result.message,
      confirmationNumber: result.confirmationNumber,
      screenshotPath: result.screenshotPath,
      durationMs: result.durationMs,
      errors: result.errors,
      createdAt: now,
      updatedAt: now,
    };

    this.entries.set(id, record);

    log.info(
      {
        entryId: id,
        contestId: result.contestId,
        profileId: result.profileId,
        status: result.status,
      },
      'Entry recorded',
    );

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
    const record = this.entries.get(entryId);
    if (!record) {
      log.warn({ entryId }, 'Entry not found for status update');
      return;
    }

    record.status = status;
    record.updatedAt = new Date().toISOString();

    if (details) {
      if (details.message !== undefined) record.message = details.message;
      if (details.confirmationNumber !== undefined) record.confirmationNumber = details.confirmationNumber;
      if (details.screenshotPath !== undefined) record.screenshotPath = details.screenshotPath;
      if (details.errors !== undefined) record.errors = details.errors;
    }

    log.debug({ entryId, status }, 'Entry status updated');
  }

  /**
   * Update the entry limit counter after a successful entry.
   */
  async updateEntryLimit(
    contestId: string,
    profileId: string,
    entryFrequency: string = 'once',
  ): Promise<void> {
    const key = this.limitKey(contestId, profileId);
    const existing = this.entryLimits.get(key);
    const now = new Date().toISOString();

    const intervalMs = FREQUENCY_INTERVALS[entryFrequency] ?? FREQUENCY_INTERVALS['once']!;
    const nextEligible = intervalMs === Infinity
      ? null
      : intervalMs === 0
        ? now
        : new Date(Date.now() + intervalMs).toISOString();

    if (existing) {
      existing.entryCount++;
      existing.lastEnteredAt = now;
      existing.nextEligibleAt = nextEligible;
    } else {
      this.entryLimits.set(key, {
        contestId,
        profileId,
        entryCount: 1,
        lastEnteredAt: now,
        nextEligibleAt: nextEligible,
      });
    }

    log.debug(
      { contestId, profileId, entryFrequency, nextEligible },
      'Entry limit updated',
    );
  }

  /**
   * Check whether a profile can enter a contest based on frequency limits.
   * Returns true if the profile is eligible to enter.
   */
  async checkEntryLimit(contestId: string, profileId: string): Promise<boolean> {
    const key = this.limitKey(contestId, profileId);
    const limit = this.entryLimits.get(key);

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
  }

  /**
   * Retrieve an entry record by ID.
   */
  async getEntry(entryId: string): Promise<EntryRecord | null> {
    return this.entries.get(entryId) ?? null;
  }

  /**
   * Retrieve all entries for a contest.
   */
  async getEntriesForContest(contestId: string): Promise<EntryRecord[]> {
    const results: EntryRecord[] = [];
    for (const record of this.entries.values()) {
      if (record.contestId === contestId) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * Retrieve all entries for a profile.
   */
  async getEntriesForProfile(profileId: string): Promise<EntryRecord[]> {
    const results: EntryRecord[] = [];
    for (const record of this.entries.values()) {
      if (record.profileId === profileId) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * Get the entry limit record for a contest-profile pair.
   */
  async getEntryLimit(contestId: string, profileId: string): Promise<EntryLimitRecord | null> {
    const key = this.limitKey(contestId, profileId);
    return this.entryLimits.get(key) ?? null;
  }

  /**
   * Get the total number of recorded entries.
   */
  getEntryCount(): number {
    return this.entries.size;
  }

  /**
   * Generate the composite key for entry limit tracking.
   */
  private limitKey(contestId: string, profileId: string): string {
    return `${contestId}:${profileId}`;
  }
}
