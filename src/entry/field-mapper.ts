/**
 * Field mapper - maps analyzed form fields to profile data values.
 *
 * Handles smart matching for different naming conventions, combined
 * fields (e.g. full name), phone formatting, date formatting, and
 * state name/abbreviation normalization.
 */

import { getLogger } from '../shared/logger.js';
import type { Profile, AnalyzedField, FieldMapping } from './types.js';

const log = getLogger('entry', { component: 'field-mapper' });

// ---------------------------------------------------------------------------
// US state abbreviation map
// ---------------------------------------------------------------------------

const STATE_ABBREVIATIONS: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN',
  'mississippi': 'MS', 'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE',
  'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK', 'oregon': 'OR',
  'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA',
  'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
  'district of columbia': 'DC',
};

const ABBREVIATION_TO_STATE: Record<string, string> = {};
for (const [name, abbr] of Object.entries(STATE_ABBREVIATIONS)) {
  ABBREVIATION_TO_STATE[abbr] = name;
}

export class FieldMapper {
  /**
   * Map analyzed form fields to profile data values.
   * Returns an ordered list of field mappings ready for the form filler.
   */
  mapFields(fields: AnalyzedField[], profile: Profile): FieldMapping[] {
    const mappings: FieldMapping[] = [];

    for (const field of fields) {
      if (field.mappedProfileField === 'unknown' || field.confidence < 0.3) {
        log.debug(
          { selector: field.selector, mappedField: field.mappedProfileField, confidence: field.confidence },
          'Skipping unmapped or low-confidence field',
        );
        continue;
      }

      const mapping = this.createMapping(field, profile);
      if (mapping) {
        mappings.push(mapping);
      }
    }

    log.info({ mappingCount: mappings.length, totalFields: fields.length }, 'Field mapping complete');
    return mappings;
  }

  /**
   * Create a single field mapping from an analyzed field and profile.
   */
  private createMapping(field: AnalyzedField, profile: Profile): FieldMapping | null {
    const value = this.getProfileValue(field, profile);
    if (!value) {
      log.debug(
        { selector: field.selector, profileField: field.mappedProfileField },
        'No profile value for mapped field',
      );
      return null;
    }

    const method = this.determineMethod(field);

    return {
      selector: field.selector,
      value,
      type: field.type,
      method,
    };
  }

  /**
   * Get the appropriate profile value for a form field.
   */
  private getProfileValue(field: AnalyzedField, profile: Profile): string {
    switch (field.mappedProfileField) {
      case 'firstName':
        return profile.firstName;

      case 'lastName':
        return profile.lastName;

      case 'fullName':
        return `${profile.firstName} ${profile.lastName}`;

      case 'email':
        return profile.email;

      case 'phone':
        return this.formatPhone(profile.phone, field);

      case 'addressLine1':
        return profile.addressLine1;

      case 'addressLine2':
        return profile.addressLine2 ?? '';

      case 'city':
        return profile.city;

      case 'state':
        return this.formatState(profile.state, field);

      case 'zip':
        return this.formatZip(profile.zip, field);

      case 'country':
        return this.formatCountry(profile.country, field);

      case 'dateOfBirth':
        return this.formatDateOfBirth(profile.dateOfBirth, field);

      case 'gender':
        return profile.gender ?? '';

      case 'age':
        return this.calculateAge(profile.dateOfBirth);

      default:
        return '';
    }
  }

  /**
   * Determine the interaction method for a field.
   */
  private determineMethod(field: AnalyzedField): 'type' | 'select' | 'click' | 'check' {
    const type = field.type.toLowerCase();

    if (type === 'select-one' || type === 'select' || type === 'select-multiple') {
      return 'select';
    }
    if (type === 'checkbox') {
      return 'check';
    }
    if (type === 'radio') {
      return 'click';
    }

    return 'type';
  }

  /**
   * Format phone number based on field expectations.
   */
  private formatPhone(phone: string, field: AnalyzedField): string {
    // Strip to digits only
    const digits = phone.replace(/\D/g, '');

    // Check field hints for format preference
    const hint = `${field.placeholder} ${field.label} ${field.name}`.toLowerCase();

    // If field seems to expect just 10 digits
    if (hint.includes('no dashes') || hint.includes('no spaces') || hint.includes('digits only')) {
      return digits.slice(-10);
    }

    // If placeholder has a specific format
    if (field.placeholder.includes('(')) {
      // Format as (XXX) XXX-XXXX
      const d = digits.slice(-10);
      if (d.length === 10) {
        return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
      }
    }

    if (field.placeholder.includes('-')) {
      // Format as XXX-XXX-XXXX
      const d = digits.slice(-10);
      if (d.length === 10) {
        return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
      }
    }

    // Default: return the cleaned 10-digit number
    const d = digits.slice(-10);
    if (d.length === 10) {
      return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    }

    return phone;
  }

  /**
   * Format state based on whether the field expects a name or abbreviation.
   */
  private formatState(state: string, field: AnalyzedField): string {
    // If it is a select field, match against available options
    if (field.options && field.options.length > 0) {
      return this.matchStateOption(state, field.options);
    }

    // If state is already an abbreviation, return as-is
    if (state.length === 2 && state === state.toUpperCase()) {
      return state;
    }

    // Try to convert name to abbreviation
    const abbr = STATE_ABBREVIATIONS[state.toLowerCase()];
    if (abbr) {
      return abbr;
    }

    return state;
  }

  /**
   * Match a state value against select options.
   */
  private matchStateOption(state: string, options: Array<{ value: string; text: string }>): string {
    const stateLower = state.toLowerCase();
    const stateAbbr = STATE_ABBREVIATIONS[stateLower] ?? state.toUpperCase();
    const fullName = ABBREVIATION_TO_STATE[state.toUpperCase()] ?? state;

    // Try exact value match
    for (const opt of options) {
      if (opt.value.toUpperCase() === stateAbbr) {
        return opt.value;
      }
    }

    // Try text match (full name)
    for (const opt of options) {
      if (opt.text.toLowerCase() === fullName.toLowerCase()) {
        return opt.value;
      }
    }

    // Try text match (abbreviation)
    for (const opt of options) {
      if (opt.text.toUpperCase() === stateAbbr) {
        return opt.value;
      }
    }

    // Try partial match
    for (const opt of options) {
      if (opt.text.toLowerCase().includes(stateLower) || opt.value.toLowerCase().includes(stateLower)) {
        return opt.value;
      }
    }

    return stateAbbr;
  }

  /**
   * Format zip code. Handle ZIP+4 vs ZIP5.
   */
  private formatZip(zip: string, field: AnalyzedField): string {
    const digitsOnly = zip.replace(/\D/g, '');
    const hint = `${field.placeholder} ${field.label} ${field.name}`.toLowerCase();

    // If field expects ZIP+4 and we have enough digits
    if ((hint.includes('zip+4') || hint.includes('zip4')) && digitsOnly.length >= 9) {
      return `${digitsOnly.slice(0, 5)}-${digitsOnly.slice(5, 9)}`;
    }

    // Default: 5-digit zip
    return digitsOnly.slice(0, 5);
  }

  /**
   * Format country for select or text fields.
   */
  private formatCountry(country: string, field: AnalyzedField): string {
    if (field.options && field.options.length > 0) {
      return this.matchCountryOption(country, field.options);
    }
    return country;
  }

  /**
   * Match country against select options.
   */
  private matchCountryOption(country: string, options: Array<{ value: string; text: string }>): string {
    const countryLower = country.toLowerCase();
    const aliases: Record<string, string[]> = {
      'us': ['united states', 'usa', 'us', 'united states of america', 'u.s.', 'u.s.a.'],
      'ca': ['canada', 'ca'],
      'uk': ['united kingdom', 'uk', 'gb', 'great britain'],
    };

    // Find the alias group
    let searchTerms = [countryLower];
    for (const [, group] of Object.entries(aliases)) {
      if (group.includes(countryLower)) {
        searchTerms = group;
        break;
      }
    }

    // Try matching
    for (const opt of options) {
      const valLower = opt.value.toLowerCase();
      const textLower = opt.text.toLowerCase();
      for (const term of searchTerms) {
        if (valLower === term || textLower === term || textLower.includes(term)) {
          return opt.value;
        }
      }
    }

    return country;
  }

  /**
   * Format date of birth based on field type and hints.
   */
  private formatDateOfBirth(dob: string, field: AnalyzedField): string {
    // Parse the stored DOB (expected: YYYY-MM-DD or MM/DD/YYYY)
    let month: string;
    let day: string;
    let year: string;

    const isoMatch = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      year = isoMatch[1]!;
      month = isoMatch[2]!;
      day = isoMatch[3]!;
    } else {
      const usMatch = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (usMatch) {
        month = usMatch[1]!.padStart(2, '0');
        day = usMatch[2]!.padStart(2, '0');
        year = usMatch[3]!;
      } else {
        return dob;
      }
    }

    // For HTML date input
    if (field.type === 'date') {
      return `${year}-${month}-${day}`;
    }

    // Check placeholder for format hint
    const placeholder = field.placeholder.toLowerCase();
    if (placeholder.includes('yyyy-mm-dd') || placeholder.includes('iso')) {
      return `${year}-${month}-${day}`;
    }
    if (placeholder.includes('dd/mm/yyyy')) {
      return `${day}/${month}/${year}`;
    }

    // Default: MM/DD/YYYY
    return `${month}/${day}/${year}`;
  }

  /**
   * Calculate age from date of birth string.
   */
  private calculateAge(dob: string): string {
    let year: number;
    let month: number;
    let day: number;

    const isoMatch = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      year = parseInt(isoMatch[1]!, 10);
      month = parseInt(isoMatch[2]!, 10);
      day = parseInt(isoMatch[3]!, 10);
    } else {
      const usMatch = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (usMatch) {
        month = parseInt(usMatch[1]!, 10);
        day = parseInt(usMatch[2]!, 10);
        year = parseInt(usMatch[3]!, 10);
      } else {
        return '';
      }
    }

    const today = new Date();
    let age = today.getFullYear() - year;
    const monthDiff = today.getMonth() + 1 - month;
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
      age--;
    }

    return String(age);
  }
}
