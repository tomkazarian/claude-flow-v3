/**
 * Address validation and normalization.
 *
 * Provides basic validation of US mailing addresses: required fields,
 * state code format, ZIP format, and state/ZIP consistency. Normalizes
 * common abbreviations and capitalization.
 */

import { getLogger } from '../shared/logger.js';

const logger = getLogger('profile', { component: 'address-validator' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export interface AddressValidation {
  valid: boolean;
  normalized: Address;
  suggestions?: string[];
  errors?: string[];
}

// ---------------------------------------------------------------------------
// State-to-ZIP prefix mapping (approximate ranges)
// ---------------------------------------------------------------------------

const STATE_ZIP_PREFIXES: Record<string, string[]> = {
  AL: ['35', '36'],
  AK: ['99'],
  AZ: ['85', '86'],
  AR: ['71', '72'],
  CA: ['90', '91', '92', '93', '94', '95', '96'],
  CO: ['80', '81'],
  CT: ['06'],
  DE: ['19'],
  FL: ['32', '33', '34'],
  GA: ['30', '31', '39'],
  HI: ['96'],
  ID: ['83'],
  IL: ['60', '61', '62'],
  IN: ['46', '47'],
  IA: ['50', '51', '52'],
  KS: ['66', '67'],
  KY: ['40', '41', '42'],
  LA: ['70', '71'],
  ME: ['03', '04'],
  MD: ['20', '21'],
  MA: ['01', '02', '05'],
  MI: ['48', '49'],
  MN: ['55', '56'],
  MS: ['38', '39'],
  MO: ['63', '64', '65'],
  MT: ['59'],
  NE: ['68', '69'],
  NV: ['88', '89'],
  NH: ['03'],
  NJ: ['07', '08'],
  NM: ['87', '88'],
  NY: ['10', '11', '12', '13', '14'],
  NC: ['27', '28'],
  ND: ['58'],
  OH: ['43', '44', '45'],
  OK: ['73', '74'],
  OR: ['97'],
  PA: ['15', '16', '17', '18', '19'],
  RI: ['02'],
  SC: ['29'],
  SD: ['57'],
  TN: ['37', '38'],
  TX: ['75', '76', '77', '78', '79'],
  UT: ['84'],
  VT: ['05'],
  VA: ['20', '22', '23', '24'],
  WA: ['98', '99'],
  WV: ['24', '25', '26'],
  WI: ['53', '54'],
  WY: ['82', '83'],
  DC: ['20'],
};

// ---------------------------------------------------------------------------
// Street abbreviation expansions
// ---------------------------------------------------------------------------

const ABBREVIATIONS: Record<string, string> = {
  'st': 'Street',
  'st.': 'Street',
  'str': 'Street',
  'ave': 'Avenue',
  'ave.': 'Avenue',
  'blvd': 'Boulevard',
  'blvd.': 'Boulevard',
  'dr': 'Drive',
  'dr.': 'Drive',
  'ln': 'Lane',
  'ln.': 'Lane',
  'rd': 'Road',
  'rd.': 'Road',
  'ct': 'Court',
  'ct.': 'Court',
  'cir': 'Circle',
  'cir.': 'Circle',
  'pl': 'Place',
  'pl.': 'Place',
  'pkwy': 'Parkway',
  'pkwy.': 'Parkway',
  'hwy': 'Highway',
  'hwy.': 'Highway',
  'trl': 'Trail',
  'trl.': 'Trail',
  'ter': 'Terrace',
  'ter.': 'Terrace',
  'way': 'Way',
  'apt': 'Apartment',
  'apt.': 'Apartment',
  'ste': 'Suite',
  'ste.': 'Suite',
  'fl': 'Floor',
  'fl.': 'Floor',
  'bldg': 'Building',
  'bldg.': 'Building',
  'n': 'North',
  'n.': 'North',
  's': 'South',
  's.': 'South',
  'e': 'East',
  'e.': 'East',
  'w': 'West',
  'w.': 'West',
  'ne': 'Northeast',
  'nw': 'Northwest',
  'se': 'Southeast',
  'sw': 'Southwest',
};

const VALID_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates and normalizes a US mailing address.
 *
 * Checks:
 * - Required fields (line1, city, state, zip)
 * - State is a valid 2-letter code
 * - ZIP is 5-digit or 5+4 format
 * - State/ZIP prefix consistency
 *
 * Normalization:
 * - Title-cases city name
 * - Uppercases state code
 * - Expands common street abbreviations
 */
export function validateAddress(address: Address): AddressValidation {
  const errors: string[] = [];
  const suggestions: string[] = [];

  // Required fields
  if (!address.line1 || address.line1.trim().length === 0) {
    errors.push('Address line 1 is required');
  }
  if (!address.city || address.city.trim().length === 0) {
    errors.push('City is required');
  }
  if (!address.state || address.state.trim().length === 0) {
    errors.push('State is required');
  }
  if (!address.zip || address.zip.trim().length === 0) {
    errors.push('ZIP code is required');
  }

  // State validation
  const stateUpper = address.state?.trim().toUpperCase() ?? '';
  if (stateUpper && !VALID_STATES.has(stateUpper)) {
    errors.push(`Invalid state code: ${stateUpper}`);
  }

  // ZIP validation
  const zipTrimmed = address.zip?.trim() ?? '';
  const zipValid = /^\d{5}(-\d{4})?$/.test(zipTrimmed);
  if (zipTrimmed && !zipValid) {
    errors.push(`Invalid ZIP code format: ${zipTrimmed}. Expected 5 digits or 5+4 format`);
  }

  // State/ZIP consistency check
  if (stateUpper && zipTrimmed && zipValid && VALID_STATES.has(stateUpper)) {
    const zipPrefix = zipTrimmed.slice(0, 2);
    const validPrefixes = STATE_ZIP_PREFIXES[stateUpper];
    if (validPrefixes && !validPrefixes.includes(zipPrefix)) {
      suggestions.push(
        `ZIP code ${zipTrimmed} may not match state ${stateUpper}. ` +
        `Expected ZIP prefixes for ${stateUpper}: ${validPrefixes.join(', ')}`,
      );
    }
  }

  // Normalize the address
  const normalized: Address = {
    line1: normalizeAddressLine(address.line1?.trim() ?? ''),
    line2: address.line2 ? normalizeAddressLine(address.line2.trim()) : undefined,
    city: titleCase(address.city?.trim() ?? ''),
    state: stateUpper,
    zip: zipTrimmed,
    country: address.country?.trim().toUpperCase() ?? 'US',
  };

  const valid = errors.length === 0;

  if (!valid) {
    logger.debug(
      { errors, address: { state: stateUpper, zip: zipTrimmed } },
      'Address validation failed',
    );
  }

  return {
    valid,
    normalized,
    ...(suggestions.length > 0 ? { suggestions } : {}),
    ...(errors.length > 0 ? { errors } : {}),
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes an address line by expanding abbreviations and applying
 * proper capitalization.
 */
function normalizeAddressLine(line: string): string {
  if (!line) return line;

  // Split into words and process each
  const words = line.split(/\s+/);
  const normalized = words.map((word, _index) => {
    const lower = word.toLowerCase().replace(/\.$/, '') + (word.endsWith('.') ? '.' : '');
    const lowerClean = word.toLowerCase().replace(/\.$/, '');

    // Check if it is a known abbreviation (only expand if it is the last
    // word or follows a number - common for street type suffixes)
    if (ABBREVIATIONS[lowerClean] || ABBREVIATIONS[lower]) {
      const expansion = ABBREVIATIONS[lowerClean] ?? ABBREVIATIONS[lower];
      if (expansion) {
        return expansion;
      }
    }

    // Keep numbers as-is
    if (/^\d/.test(word)) {
      return word;
    }

    // Keep ordinals as-is (1st, 2nd, 3rd, etc.)
    if (/^\d+(?:st|nd|rd|th)$/i.test(word)) {
      return word.toLowerCase();
    }

    // Title case everything else
    return titleCase(word);
  });

  return normalized.join(' ');
}

/**
 * Converts a string to Title Case.
 */
function titleCase(str: string): string {
  if (!str) return str;
  return str
    .toLowerCase()
    .split(' ')
    .map((word) => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
