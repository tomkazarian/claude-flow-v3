/**
 * Age eligibility verification.
 *
 * Calculates the current age from a date of birth and checks it against
 * a minimum age requirement. Supports contest-specific thresholds
 * (e.g. 21 for alcohol-related promotions).
 */

import { getLogger } from '../shared/logger.js';

const logger = getLogger('compliance', { component: 'age-verifier' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIN_AGE = 18;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verifies that a person born on `dateOfBirth` meets the minimum age
 * requirement as of today.
 *
 * @param dateOfBirth - ISO-8601 date string (e.g. "1990-05-15")
 * @param minAge - Minimum required age in years (default: 18)
 * @returns true if the person is at least `minAge` years old
 */
export function verifyAge(dateOfBirth: string, minAge = DEFAULT_MIN_AGE): boolean {
  if (!dateOfBirth) {
    logger.warn('Cannot verify age: date of birth is empty');
    return false;
  }

  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) {
    logger.warn({ dateOfBirth }, 'Cannot verify age: invalid date of birth');
    return false;
  }

  const age = calculateAge(dob);

  const eligible = age >= minAge;

  logger.debug(
    { dateOfBirth, age, minAge, eligible },
    'Age verification result',
  );

  return eligible;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Calculates age in complete years from a date of birth to today.
 * Accounts for whether the birthday has occurred yet this year.
 */
function calculateAge(dob: Date): number {
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();

  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age--;
  }

  return age;
}
