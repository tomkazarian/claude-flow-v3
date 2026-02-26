/**
 * Core compliance rule evaluation engine.
 *
 * Runs all eligibility checks (age, geographic, entry limits, exclusions)
 * against a contest/profile pair and returns a structured result with
 * any violations that would prevent or warn about entry.
 */

import { getLogger } from '../shared/logger.js';
import { verifyAge } from './age-verifier.js';
import { checkGeoEligibility } from './geo-checker.js';
import type { EntryLimiter } from './entry-limiter.js';

const logger = getLogger('compliance', { component: 'rules-engine' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Contest {
  id: string;
  title: string;
  ageRequirement: number | null;
  geoRestrictions: string;
  entryFrequency: string | null;
  maxEntries: number | null;
  startDate: string | null;
  endDate: string | null;
  requiresPurchase?: boolean;
  termsUrl: string | null;
}

export interface Profile {
  id: string;
  dateOfBirth: string | null;
  state: string | null;
  country: string;
}

export interface ComplianceViolation {
  rule: string;
  message: string;
  severity: 'block' | 'warn';
}

export interface ComplianceResult {
  eligible: boolean;
  violations: ComplianceViolation[];
}

// ---------------------------------------------------------------------------
// ComplianceEngine
// ---------------------------------------------------------------------------

export class ComplianceEngine {
  private readonly entryLimiter: EntryLimiter | null;

  /**
   * @param entryLimiter - Optional. When provided, the engine can run
   *   entry-limit checks against the database via `checkFullEligibility`.
   *   The synchronous `checkEligibility` method still works without it
   *   for contexts that only need age/geo/date checks.
   */
  constructor(entryLimiter?: EntryLimiter) {
    this.entryLimiter = entryLimiter ?? null;
  }

  /**
   * Evaluates all synchronous compliance rules for a contest/profile
   * combination. Does NOT check entry limits (which require DB access).
   *
   * Use `checkFullEligibility` for a complete check that includes entry limits.
   *
   * A profile is ineligible if any violation has severity 'block'.
   * Warnings do not prevent entry but should be logged.
   */
  checkEligibility(contest: Contest, profile: Profile): ComplianceResult {
    const violations: ComplianceViolation[] = [];

    // 1. Age verification
    this.checkAge(contest, profile, violations);

    // 2. Geographic eligibility
    this.checkGeo(contest, profile, violations);

    // 3. Contest date validity
    this.checkDates(contest, violations);

    // 4. Purchase requirement warning
    this.checkPurchaseRequirement(contest, violations);

    // 5. Missing profile data warnings
    this.checkProfileCompleteness(profile, contest, violations);

    return this.buildResult(contest.id, profile.id, violations);
  }

  /**
   * Evaluates ALL compliance rules including entry limits (requires DB).
   *
   * This is the method that should be called before submitting an entry,
   * as it also checks whether the profile has exceeded the entry limit
   * or is still within the frequency window.
   *
   * Requires the engine to have been constructed with an EntryLimiter.
   */
  async checkFullEligibility(
    contest: Contest,
    profile: Profile,
  ): Promise<ComplianceResult> {
    const violations: ComplianceViolation[] = [];

    // 1. Age verification
    this.checkAge(contest, profile, violations);

    // 2. Geographic eligibility
    this.checkGeo(contest, profile, violations);

    // 3. Contest date validity
    this.checkDates(contest, violations);

    // 4. Purchase requirement warning
    this.checkPurchaseRequirement(contest, violations);

    // 5. Missing profile data warnings
    this.checkProfileCompleteness(profile, contest, violations);

    // 6. Entry limit / frequency check (requires DB)
    await this.checkEntryLimits(contest, profile, violations);

    return this.buildResult(contest.id, profile.id, violations);
  }

  // ---------------------------------------------------------------------------
  // Individual rule checks
  // ---------------------------------------------------------------------------

  private checkAge(
    contest: Contest,
    profile: Profile,
    violations: ComplianceViolation[],
  ): void {
    const minAge = contest.ageRequirement ?? 18;

    if (!profile.dateOfBirth) {
      violations.push({
        rule: 'age_verification',
        message: `Profile is missing date of birth. Minimum age for this contest is ${minAge}.`,
        severity: 'warn',
      });
      return;
    }

    if (!verifyAge(profile.dateOfBirth, minAge)) {
      violations.push({
        rule: 'age_verification',
        message: `Profile does not meet minimum age requirement of ${minAge}`,
        severity: 'block',
      });
    }
  }

  private checkGeo(
    contest: Contest,
    profile: Profile,
    violations: ComplianceViolation[],
  ): void {
    if (!contest.geoRestrictions || contest.geoRestrictions === '{}') {
      return; // No restrictions
    }

    let restrictions: string[] = [];
    try {
      const parsed = JSON.parse(contest.geoRestrictions);
      if (Array.isArray(parsed)) {
        restrictions = parsed;
      } else if (typeof parsed === 'object' && parsed !== null) {
        // Support structured format: { states: [...], countries: [...] }
        if (Array.isArray(parsed.states)) {
          restrictions = parsed.states;
        }
        if (Array.isArray(parsed.countries)) {
          restrictions = [...restrictions, ...parsed.countries];
        }
        // Support excluded states/countries
        if (Array.isArray(parsed.excludedStates)) {
          for (const state of parsed.excludedStates) {
            restrictions.push(`excludes:US-${state}`);
          }
        }
        if (Array.isArray(parsed.excludedCountries)) {
          for (const country of parsed.excludedCountries) {
            restrictions.push(`excludes:${country}`);
          }
        }
      }
    } catch {
      logger.warn(
        { contestId: contest.id, raw: contest.geoRestrictions },
        'Failed to parse geo restrictions',
      );
      return;
    }

    if (restrictions.length === 0) {
      return;
    }

    if (!profile.state && !profile.country) {
      violations.push({
        rule: 'geo_eligibility',
        message:
          'Profile is missing state and country information for geo check',
        severity: 'warn',
      });
      return;
    }

    const isEligible = checkGeoEligibility(
      profile.state ?? '',
      profile.country,
      restrictions,
    );

    if (!isEligible) {
      violations.push({
        rule: 'geo_eligibility',
        message: `Profile location (${profile.state ?? 'unknown'}, ${profile.country}) is not eligible for this contest`,
        severity: 'block',
      });
    }
  }

  private checkDates(
    contest: Contest,
    violations: ComplianceViolation[],
  ): void {
    const now = new Date();

    if (contest.startDate) {
      const start = new Date(contest.startDate);
      if (!isNaN(start.getTime()) && start > now) {
        violations.push({
          rule: 'contest_dates',
          message: `Contest has not started yet. Start date: ${contest.startDate}`,
          severity: 'block',
        });
      }
    }

    if (contest.endDate) {
      const end = new Date(contest.endDate);
      if (!isNaN(end.getTime()) && end < now) {
        violations.push({
          rule: 'contest_dates',
          message: `Contest has ended. End date: ${contest.endDate}`,
          severity: 'block',
        });
      }

      // Warn if ending within 24 hours
      if (
        !isNaN(end.getTime()) &&
        end > now &&
        end.getTime() - now.getTime() < 86_400_000
      ) {
        violations.push({
          rule: 'contest_dates',
          message: 'Contest ends within 24 hours',
          severity: 'warn',
        });
      }
    }
  }

  private checkPurchaseRequirement(
    contest: Contest,
    violations: ComplianceViolation[],
  ): void {
    if (contest.requiresPurchase) {
      violations.push({
        rule: 'purchase_required',
        message: 'This contest requires a purchase for entry',
        severity: 'warn',
      });
    }
  }

  private checkProfileCompleteness(
    profile: Profile,
    contest: Contest,
    _violations: ComplianceViolation[],
  ): void {
    if (!profile.dateOfBirth && (contest.ageRequirement ?? 0) > 0) {
      // Already handled in checkAge, but note it here for completeness
    }

    if (
      !profile.state &&
      contest.geoRestrictions &&
      contest.geoRestrictions !== '{}'
    ) {
      // Already handled in checkGeo
    }
  }

  /**
   * Checks entry frequency and max-entry limits using the database.
   * Only runs if an EntryLimiter was supplied to the constructor.
   */
  private async checkEntryLimits(
    contest: Contest,
    profile: Profile,
    violations: ComplianceViolation[],
  ): Promise<void> {
    if (!this.entryLimiter) {
      logger.debug(
        'No EntryLimiter configured, skipping entry limit check',
      );
      return;
    }

    try {
      const canEnter = await this.entryLimiter.canEnter(
        contest.id,
        profile.id,
      );

      if (!canEnter) {
        violations.push({
          rule: 'entry_limits',
          message:
            'Profile has reached the entry limit or is not yet eligible for a new entry',
          severity: 'block',
        });
      }
    } catch (error) {
      // Entry limit check failure should not crash the compliance pipeline.
      // Log and add a warning so the caller knows the check was inconclusive.
      const msg =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { contestId: contest.id, profileId: profile.id, error: msg },
        'Entry limit check failed',
      );
      violations.push({
        rule: 'entry_limits',
        message: `Entry limit check failed: ${msg}`,
        severity: 'warn',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildResult(
    contestId: string,
    profileId: string,
    violations: ComplianceViolation[],
  ): ComplianceResult {
    const hasBlockingViolation = violations.some(
      (v) => v.severity === 'block',
    );

    const result: ComplianceResult = {
      eligible: !hasBlockingViolation,
      violations,
    };

    if (violations.length > 0) {
      logger.info(
        {
          contestId,
          profileId,
          eligible: result.eligible,
          violationCount: violations.length,
          blockCount: violations.filter((v) => v.severity === 'block')
            .length,
          warnCount: violations.filter((v) => v.severity === 'warn')
            .length,
        },
        'Compliance check completed with violations',
      );
    } else {
      logger.debug(
        { contestId, profileId },
        'Compliance check passed with no violations',
      );
    }

    return result;
  }
}
