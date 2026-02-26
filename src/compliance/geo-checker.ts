/**
 * Geographic eligibility checking.
 *
 * Evaluates whether a profile's location (state/country) satisfies
 * contest geographic restrictions. Supports inclusion lists, exclusion
 * lists, and mixed formats.
 */

import { getLogger } from '../shared/logger.js';

const logger = getLogger('compliance', { component: 'geo-checker' });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether a profile's geographic location is eligible for a contest.
 *
 * Restriction formats supported:
 * - Country only: "US", "CA"
 * - Country-State: "US-CA", "US-NY"
 * - Multiple states: "US-CA,US-TX" (comma-separated in one string) or
 *   separate array entries
 * - Exclusions: "excludes:US-FL" or "excludes:US-FL,US-GA"
 *
 * When restrictions contain:
 * - Only exclusions: profile is eligible unless explicitly excluded
 * - Only inclusions: profile must match at least one inclusion
 * - Both: profile must match an inclusion AND not match any exclusion
 *
 * @param profileState - Two-letter state code (e.g. "CA")
 * @param profileCountry - Country code (e.g. "US")
 * @param geoRestrictions - Array of restriction strings
 * @returns true if the profile's location is eligible
 */
export function checkGeoEligibility(
  profileState: string,
  profileCountry: string,
  geoRestrictions: string[],
): boolean {
  if (!geoRestrictions || geoRestrictions.length === 0) {
    return true; // No restrictions means everyone is eligible
  }

  const normalizedState = profileState.toUpperCase().trim();
  const normalizedCountry = profileCountry.toUpperCase().trim();

  // Separate exclusions from inclusions
  const exclusions: string[] = [];
  const inclusions: string[] = [];

  for (const restriction of geoRestrictions) {
    // Handle comma-separated values within a single restriction string
    const parts = restriction.split(',').map((p) => p.trim());

    for (const part of parts) {
      if (part.toLowerCase().startsWith('excludes:')) {
        const excluded = part.slice('excludes:'.length).trim();
        // The excluded value may itself be comma-separated
        const excludedParts = excluded.split(',').map((e) => e.trim().toUpperCase());
        exclusions.push(...excludedParts);
      } else if (part.length > 0) {
        inclusions.push(part.toUpperCase());
      }
    }
  }

  // Check exclusions first
  if (exclusions.length > 0) {
    for (const excluded of exclusions) {
      if (matchesLocation(excluded, normalizedState, normalizedCountry)) {
        logger.debug(
          { excluded, state: normalizedState, country: normalizedCountry },
          'Profile excluded by geo restriction',
        );
        return false;
      }
    }
  }

  // If there are no inclusions, and the profile was not excluded, it is eligible
  if (inclusions.length === 0) {
    return true;
  }

  // Check inclusions: profile must match at least one
  for (const included of inclusions) {
    if (matchesLocation(included, normalizedState, normalizedCountry)) {
      return true;
    }
  }

  logger.debug(
    {
      inclusions,
      state: normalizedState,
      country: normalizedCountry,
    },
    'Profile not in inclusion list',
  );

  return false;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether a restriction entry matches the profile's location.
 *
 * A restriction of "US" matches any US state.
 * A restriction of "US-CA" matches only California.
 * A restriction of "CA" (2-letter) is ambiguous - could be a state
 * or country code. We treat it as a state if the profile country is US.
 */
function matchesLocation(
  restriction: string,
  state: string,
  country: string,
): boolean {
  const parts = restriction.split('-');

  if (parts.length === 2) {
    // Format: "US-CA" (country-state)
    const [restrictionCountry, restrictionState] = parts as [string, string];
    return (
      country === restrictionCountry &&
      state === restrictionState
    );
  }

  if (parts.length === 1) {
    const value = parts[0]!;

    // If it is a 2-letter code, it could be a country or a state
    if (value.length === 2) {
      // Match as country
      if (value === country) {
        return true;
      }

      // If the profile is US and the restriction is a state code, match
      if (country === 'US' && value === state) {
        return true;
      }
    }

    // Match as country for longer codes
    return value === country;
  }

  return false;
}
