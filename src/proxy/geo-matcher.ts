import { getLogger } from '../shared/logger.js';
import type { ProxyConfig } from './types.js';

const log = getLogger('proxy', { component: 'geo-matcher' });

/**
 * Maps common US state abbreviations to full names and vice versa.
 */
const US_STATES: Record<string, string> = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas',
  CA: 'california', CO: 'colorado', CT: 'connecticut', DE: 'delaware',
  FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho',
  IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas',
  KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland',
  MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi',
  MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada',
  NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york',
  NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma',
  OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina',
  SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah',
  VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia',
  WI: 'wisconsin', WY: 'wyoming', DC: 'district of columbia',
};

/** Reverse lookup: full name -> abbreviation */
const STATE_NAME_TO_ABBREV = new Map<string, string>(
  Object.entries(US_STATES).map(([abbrev, name]) => [name, abbrev]),
);

interface GeoRestriction {
  country?: string;
  states?: string[];
}

/**
 * Parses an array of geo restriction strings into structured form.
 * Accepted formats:
 *   - "US" (country only)
 *   - "US-CA" (country and state)
 *   - "United States" (country name)
 *   - "California" (US state name)
 */
export function parseGeoRestrictions(restrictions: string[]): GeoRestriction {
  const states: string[] = [];
  let country: string | undefined;

  for (const raw of restrictions) {
    const trimmed = raw.trim();

    // Check for "CC-SS" format (e.g. "US-CA")
    const dashParts = trimmed.split('-');
    if (dashParts.length === 2 && dashParts[0]!.length === 2 && dashParts[1]!.length === 2) {
      country = dashParts[0]!.toUpperCase();
      states.push(dashParts[1]!.toUpperCase());
      continue;
    }

    // Check for a 2-letter country code
    if (trimmed.length === 2) {
      const upper = trimmed.toUpperCase();
      // If it looks like a US state abbreviation
      if (US_STATES[upper]) {
        country = 'US';
        states.push(upper);
      } else {
        country = upper;
      }
      continue;
    }

    // Check for a US state full name
    const lower = trimmed.toLowerCase();
    const abbrev = STATE_NAME_TO_ABBREV.get(lower);
    if (abbrev) {
      country = 'US';
      states.push(abbrev);
      continue;
    }

    // Treat as country name - map common names to ISO codes
    const countryCode = mapCountryNameToCode(lower);
    if (countryCode) {
      country = countryCode;
    }
  }

  return { country, states: states.length > 0 ? states : undefined };
}

/**
 * Maps common country names to their 2-letter ISO codes.
 */
function mapCountryNameToCode(name: string): string | undefined {
  const mapping: Record<string, string> = {
    'united states': 'US',
    'united states of america': 'US',
    'usa': 'US',
    'canada': 'CA',
    'united kingdom': 'GB',
    'uk': 'GB',
    'great britain': 'GB',
    'australia': 'AU',
    'germany': 'DE',
    'france': 'FR',
    'japan': 'JP',
    'brazil': 'BR',
    'india': 'IN',
    'mexico': 'MX',
    'italy': 'IT',
    'spain': 'ES',
    'netherlands': 'NL',
    'sweden': 'SE',
    'norway': 'NO',
    'denmark': 'DK',
    'finland': 'FI',
    'switzerland': 'CH',
    'austria': 'AT',
    'belgium': 'BE',
    'ireland': 'IE',
    'new zealand': 'NZ',
    'singapore': 'SG',
    'south korea': 'KR',
    'poland': 'PL',
    'portugal': 'PT',
  };
  return mapping[name];
}

/**
 * Finds the best proxy matching the geographic restrictions of a contest.
 *
 * Matching priority:
 *   1. Exact state + country match
 *   2. Same country, any state
 *   3. null (no match)
 */
export function matchProxyToContest(
  contest: { geoRestrictions: string[] },
  availableProxies: ProxyConfig[],
): ProxyConfig | null {
  if (!contest.geoRestrictions || contest.geoRestrictions.length === 0) {
    // No restrictions; any proxy is fine. Pick the best one.
    return pickBest(availableProxies);
  }

  const parsed = parseGeoRestrictions(contest.geoRestrictions);

  if (!parsed.country) {
    log.warn({ restrictions: contest.geoRestrictions }, 'Could not parse geo restrictions');
    return pickBest(availableProxies);
  }

  const countryLower = parsed.country.toLowerCase();

  // Try exact state match first
  if (parsed.states && parsed.states.length > 0) {
    const stateSet = new Set(parsed.states.map((s) => s.toLowerCase()));

    const stateMatches = availableProxies.filter(
      (p) =>
        p.country?.toLowerCase() === countryLower &&
        p.state !== undefined &&
        stateSet.has(p.state.toLowerCase()),
    );

    if (stateMatches.length > 0) {
      log.debug(
        { country: parsed.country, states: parsed.states, matches: stateMatches.length },
        'Found exact state match proxies',
      );
      return pickBest(stateMatches);
    }
  }

  // Fall back to country match
  const countryMatches = availableProxies.filter(
    (p) => p.country?.toLowerCase() === countryLower,
  );

  if (countryMatches.length > 0) {
    log.debug(
      { country: parsed.country, matches: countryMatches.length },
      'Found country match proxies (no exact state match)',
    );
    return pickBest(countryMatches);
  }

  log.warn(
    { country: parsed.country, states: parsed.states },
    'No proxy found matching contest geo restrictions',
  );
  return null;
}

/**
 * Picks the best proxy from a list based on health, latency, and success rate.
 */
function pickBest(proxies: ProxyConfig[]): ProxyConfig | null {
  if (proxies.length === 0) return null;

  const sorted = [...proxies].sort((a, b) => {
    // Healthy proxies first
    if (a.healthStatus === 'healthy' && b.healthStatus !== 'healthy') return -1;
    if (b.healthStatus === 'healthy' && a.healthStatus !== 'healthy') return 1;

    // Lower latency first
    const latencyDiff = a.latencyMs - b.latencyMs;
    if (Math.abs(latencyDiff) > 100) return latencyDiff;

    // Higher success rate first
    const aTotal = a.successCount + a.failureCount;
    const bTotal = b.successCount + b.failureCount;
    const aRate = aTotal > 0 ? a.successCount / aTotal : 0.5;
    const bRate = bTotal > 0 ? b.successCount / bTotal : 0.5;
    return bRate - aRate;
  });

  return sorted[0] ?? null;
}
