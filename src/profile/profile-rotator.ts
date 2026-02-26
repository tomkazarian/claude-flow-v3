/**
 * Profile rotation strategies for distributing contest entries across
 * multiple profiles to maximize coverage and avoid detection.
 *
 * Supports round-robin, random, and least-recently-used selection strategies.
 */

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getLogger } from '../shared/logger.js';
import { AppError } from '../shared/errors.js';
import { pickRandom } from '../shared/utils.js';
import { profiles, entryLimits, contests } from '../db/schema.js';
import type { Profile } from './profile-manager.js';

const logger = getLogger('profile', { component: 'profile-rotator' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RotationStrategy = 'round-robin' | 'random' | 'least-recently-used';

export interface RotatorOptions {
  strategy?: RotationStrategy;
}

// ---------------------------------------------------------------------------
// ProfileRotator
// ---------------------------------------------------------------------------

export class ProfileRotator {
  private readonly db: BetterSQLite3Database;
  private readonly strategy: RotationStrategy;

  /**
   * Tracks the last profile index returned per contest for round-robin.
   * Map<contestId, lastIndex>
   */
  private roundRobinState = new Map<string, number>();

  constructor(db: BetterSQLite3Database, options: RotatorOptions = {}) {
    this.db = db;
    this.strategy = options.strategy ?? 'round-robin';
    logger.info({ strategy: this.strategy }, 'ProfileRotator initialized');
  }

  /**
   * Returns the next eligible profile for a given contest based on the
   * configured rotation strategy. Filters out profiles that:
   *  - are inactive
   *  - have hit their entry limit for this contest
   *  - do not meet age/geo requirements
   *
   * @throws {AppError} If no eligible profiles are available
   */
  async getNextProfile(contestId: string): Promise<Profile> {
    const eligibleProfiles = await this.getEligibleProfiles(contestId);

    if (eligibleProfiles.length === 0) {
      throw new AppError(
        `No eligible profiles available for contest ${contestId}`,
        'NO_ELIGIBLE_PROFILES',
        404,
      );
    }

    let selected: Profile;

    switch (this.strategy) {
      case 'round-robin':
        selected = this.selectRoundRobin(contestId, eligibleProfiles);
        break;
      case 'random':
        selected = this.selectRandom(eligibleProfiles);
        break;
      case 'least-recently-used':
        selected = await this.selectLeastRecentlyUsed(
          contestId,
          eligibleProfiles,
        );
        break;
      default:
        selected = this.selectRoundRobin(contestId, eligibleProfiles);
    }

    logger.debug(
      {
        contestId,
        profileId: selected.id,
        strategy: this.strategy,
        eligibleCount: eligibleProfiles.length,
      },
      'Profile selected for contest entry',
    );

    return selected;
  }

  // ---------------------------------------------------------------------------
  // Strategy implementations
  // ---------------------------------------------------------------------------

  private selectRoundRobin(
    contestId: string,
    eligible: Profile[],
  ): Profile {
    const lastIndex = this.roundRobinState.get(contestId) ?? -1;
    const nextIndex = (lastIndex + 1) % eligible.length;
    this.roundRobinState.set(contestId, nextIndex);
    return eligible[nextIndex]!;
  }

  private selectRandom(eligible: Profile[]): Profile {
    return pickRandom(eligible);
  }

  private async selectLeastRecentlyUsed(
    contestId: string,
    eligible: Profile[],
  ): Promise<Profile> {
    // Build a map of profileId -> lastEntryAt
    const limits = this.db
      .select()
      .from(entryLimits)
      .where(eq(entryLimits.contestId, contestId))
      .all();

    const lastEntryMap = new Map<string, string>();
    for (const limit of limits) {
      if (limit.lastEntryAt) {
        lastEntryMap.set(limit.profileId, limit.lastEntryAt);
      }
    }

    // Sort eligible profiles by last entry time (oldest first)
    // Profiles with no prior entry come first
    const sorted = [...eligible].sort((a, b) => {
      const aTime = lastEntryMap.get(a.id);
      const bTime = lastEntryMap.get(b.id);

      if (!aTime && !bTime) return 0;
      if (!aTime) return -1;
      if (!bTime) return 1;

      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });

    return sorted[0]!;
  }

  // ---------------------------------------------------------------------------
  // Eligibility filtering
  // ---------------------------------------------------------------------------

  private async getEligibleProfiles(
    contestId: string,
  ): Promise<Profile[]> {
    // Get all active profiles
    const allProfiles = this.db
      .select()
      .from(profiles)
      .where(eq(profiles.isActive, 1))
      .all();

    if (allProfiles.length === 0) {
      return [];
    }

    // Get contest details for age/geo requirements
    const contestRows = this.db
      .select()
      .from(contests)
      .where(eq(contests.id, contestId))
      .limit(1)
      .all();

    const contest = contestRows[0];

    // Get entry limit records for this contest
    const limitRows = this.db
      .select()
      .from(entryLimits)
      .where(eq(entryLimits.contestId, contestId))
      .all();

    const limitMap = new Map(
      limitRows.map((l) => [l.profileId, l]),
    );

    const eligible: Profile[] = [];

    for (const row of allProfiles) {
      const profile = this.rowToProfile(row);

      // Check entry limit
      const limit = limitMap.get(profile.id);
      if (limit) {
        // Check if entry count exceeds max entries
        if (
          contest?.maxEntries &&
          limit.entryCount >= contest.maxEntries
        ) {
          continue;
        }

        // Check if next eligible time has passed
        if (
          limit.nextEligibleAt &&
          new Date(limit.nextEligibleAt).getTime() > Date.now()
        ) {
          continue;
        }
      }

      // Check age requirement
      if (contest?.ageRequirement && profile.dateOfBirth) {
        const age = this.calculateAge(profile.dateOfBirth);
        if (age < contest.ageRequirement) {
          continue;
        }
      }

      // Check geo restrictions
      if (contest?.geoRestrictions && profile.state) {
        let restrictions: string[] = [];
        try {
          const parsed = JSON.parse(contest.geoRestrictions);
          if (Array.isArray(parsed)) {
            restrictions = parsed;
          } else if (typeof parsed === 'object' && parsed.states) {
            restrictions = parsed.states;
          }
        } catch {
          // Invalid geo restrictions JSON - skip this check
        }

        if (restrictions.length > 0) {
          const isExcluded = restrictions.some((r: string) => {
            if (r.startsWith('excludes:')) {
              const excluded = r.replace('excludes:', '').split(',');
              return excluded.some(
                (ex) =>
                  ex.trim().toUpperCase() ===
                    `US-${profile.state}`.toUpperCase() ||
                  ex.trim().toUpperCase() ===
                    profile.state?.toUpperCase(),
              );
            }
            return false;
          });

          if (isExcluded) {
            continue;
          }

          const hasIncludeRestrictions = restrictions.some(
            (r: string) => !r.startsWith('excludes:'),
          );
          if (hasIncludeRestrictions) {
            const included = restrictions
              .filter((r: string) => !r.startsWith('excludes:'))
              .some(
                (r: string) =>
                  r.toUpperCase() === `US-${profile.state}`.toUpperCase() ||
                  r.toUpperCase() === profile.state?.toUpperCase() ||
                  r.toUpperCase() === profile.country.toUpperCase(),
              );
            if (!included) {
              continue;
            }
          }
        }
      }

      eligible.push(profile);
    }

    return eligible;
  }

  private calculateAge(dateOfBirth: string): number {
    const dob = new Date(dateOfBirth);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDiff = now.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
      age--;
    }
    return age;
  }

  /**
   * Converts a raw DB row into a Profile object.
   * This is a lightweight conversion without decryption since the rotator
   * only needs non-encrypted fields for eligibility checks.
   */
  private rowToProfile(row: Record<string, unknown>): Profile {
    let emailAliases: string[] = [];
    if (typeof row.emailAliases === 'string') {
      try {
        emailAliases = JSON.parse(row.emailAliases);
      } catch {
        emailAliases = [];
      }
    }

    let socialAccounts: Record<string, string> = {};
    if (typeof row.socialAccounts === 'string') {
      try {
        socialAccounts = JSON.parse(row.socialAccounts);
      } catch {
        socialAccounts = {};
      }
    }

    return {
      id: row.id as string,
      firstName: row.firstName as string,
      lastName: row.lastName as string,
      email: row.email as string,
      emailAliases,
      phone: (row.phone as string | null) ?? null,
      phoneProvider: (row.phoneProvider as string | null) ?? null,
      addressLine1: (row.addressLine1 as string | null) ?? null,
      addressLine2: (row.addressLine2 as string | null) ?? null,
      city: (row.city as string | null) ?? null,
      state: (row.state as string | null) ?? null,
      zip: (row.zip as string | null) ?? null,
      country: (row.country as string) ?? 'US',
      dateOfBirth: (row.dateOfBirth as string | null) ?? null,
      gender: (row.gender as string | null) ?? null,
      socialAccounts,
      isActive: row.isActive === 1,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    };
  }
}
