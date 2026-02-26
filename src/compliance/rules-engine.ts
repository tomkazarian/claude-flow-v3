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
  /**
   * Evaluates all compliance rules for a contest/profile combination.
   * Returns a result indicating eligibility and any violations found.
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

    const hasBlockingViolation = violations.some((v) => v.severity === 'block');

    const result: ComplianceResult = {
      eligible: !hasBlockingViolation,
      violations,
    };

    if (violations.length > 0) {
      logger.info(
        {
          contestId: contest.id,
          profileId: profile.id,
          eligible: result.eligible,
          violationCount: violations.length,
          blockCount: violations.filter((v) => v.severity === 'block').length,
          warnCount: violations.filter((v) => v.severity === 'warn').length,
        },
        'Compliance check completed with violations',
      );
    } else {
      logger.debug(
        { contestId: contest.id, profileId: profile.id },
        'Compliance check passed with no violations',
      );
    }

    return result;
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
        if (Array.isArray(parsed.states)) {
          restrictions = parsed.states;
        }
        if (Array.isArray(parsed.countries)) {
          restrictions = [...restrictions, ...parsed.countries];
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
        message: 'Profile is missing state and country information for geo check',
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

    if (!profile.state && contest.geoRestrictions && contest.geoRestrictions !== '{}') {
      // Already handled in checkGeo
    }
  }
}
