/**
 * Terms of Service parser for sweepstakes contests.
 *
 * Fetches a contest's terms page and extracts key restrictions using
 * regex-based pattern matching. Handles common terms page formats to
 * identify age requirements, geographic restrictions, entry limits,
 * dates, and other eligibility criteria.
 */

import { getLogger } from '../shared/logger.js';
import { ComplianceError } from '../shared/errors.js';
import { retry } from '../shared/retry.js';
import { parseDate } from '../shared/utils.js';

const logger = getLogger('compliance', { component: 'terms-parser' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedTerms {
  minAge: number;
  geoRestrictions: string[];
  entryFrequency: string;
  maxEntries: number | null;
  startDate: string | null;
  endDate: string | null;
  excludedAffiliations: string[];
  requiresPurchase: boolean;
  voidWhereProhibited: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15_000;

const DEFAULT_TERMS: ParsedTerms = {
  minAge: 18,
  geoRestrictions: [],
  entryFrequency: 'once',
  maxEntries: null,
  startDate: null,
  endDate: null,
  excludedAffiliations: [],
  requiresPurchase: false,
  voidWhereProhibited: false,
};

// ---------------------------------------------------------------------------
// State names to abbreviation mapping
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
  'district of columbia': 'DC', 'puerto rico': 'PR',
};

// ---------------------------------------------------------------------------
// TermsParser
// ---------------------------------------------------------------------------

export class TermsParser {
  /**
   * Fetches and parses a contest's terms page, extracting key restrictions
   * and eligibility criteria.
   *
   * @param termsUrl - The URL of the terms/rules page
   * @returns Structured terms data with extracted restrictions
   */
  async parseTerms(termsUrl: string): Promise<ParsedTerms> {
    logger.info({ termsUrl }, 'Fetching and parsing contest terms');

    let html: string;

    try {
      html = await retry(
        async () => {
          const response = await fetch(termsUrl, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          return response.text();
        },
        {
          maxAttempts: 3,
          retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'fetch failed', '503'],
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { termsUrl, err: error },
        `Failed to fetch terms page: ${message}`,
      );
      throw new ComplianceError(
        `Failed to fetch terms: ${message}`,
        'TERMS_FETCH_FAILED',
        'terms_parser',
      );
    }

    // Strip HTML tags for text analysis
    const text = stripHtml(html);

    const terms: ParsedTerms = {
      minAge: this.extractMinAge(text),
      geoRestrictions: this.extractGeoRestrictions(text),
      entryFrequency: this.extractEntryFrequency(text),
      maxEntries: this.extractMaxEntries(text),
      startDate: this.extractStartDate(text),
      endDate: this.extractEndDate(text),
      excludedAffiliations: this.extractExcludedAffiliations(text),
      requiresPurchase: this.detectPurchaseRequirement(text),
      voidWhereProhibited: this.detectVoidWhereProhibited(text),
    };

    logger.info(
      {
        termsUrl,
        minAge: terms.minAge,
        geoCount: terms.geoRestrictions.length,
        frequency: terms.entryFrequency,
        maxEntries: terms.maxEntries,
        requiresPurchase: terms.requiresPurchase,
      },
      'Terms parsed successfully',
    );

    return terms;
  }

  // ---------------------------------------------------------------------------
  // Extraction methods
  // ---------------------------------------------------------------------------

  private extractMinAge(text: string): number {
    // "must be at least 21 years" or "18 years of age or older"
    const agePatterns = [
      /must\s+be\s+(?:at\s+least\s+)?(\d{2})\s+years/i,
      /(\d{2})\s+years\s+of\s+age\s+or\s+older/i,
      /(?:minimum|min)\s+age[:\s]+(\d{2})/i,
      /(?:at\s+least|over)\s+(\d{2})\s+years?\s+(?:of\s+age|old)/i,
      /open\s+to\s+(?:legal\s+)?residents?\s+.*?(\d{2})\s+years/i,
      /(?:age\s+)?(\d{2})\s+or\s+older/i,
    ];

    for (const pattern of agePatterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const age = parseInt(match[1], 10);
        if (age >= 13 && age <= 100) {
          return age;
        }
      }
    }

    return DEFAULT_TERMS.minAge;
  }

  private extractGeoRestrictions(text: string): string[] {
    const restrictions: string[] = [];

    // "open to legal residents of the United States"
    if (/open\s+to\s+(?:legal\s+)?residents?\s+of\s+(?:the\s+)?(?:United\s+States|U\.?S\.?A?\.?)/i.test(text)) {
      restrictions.push('US');
    }

    // "open to residents of [State1], [State2], and [State3]"
    const stateListMatch = text.match(
      /open\s+to\s+(?:legal\s+)?residents?\s+of\s+((?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*)?(?:\s+and\s+)?)+)/i,
    );
    if (stateListMatch?.[1]) {
      const stateNames = stateListMatch[1]
        .split(/[,]+/)
        .map((s) => s.replace(/^\s*and\s+/i, '').trim().toLowerCase());

      for (const stateName of stateNames) {
        const abbr = STATE_ABBREVIATIONS[stateName];
        if (abbr) {
          restrictions.push(`US-${abbr}`);
        }
      }
    }

    // "void in [State1], [State2]" or "not open to residents of [State]"
    const voidInMatch = text.match(
      /(?:void\s+in|not\s+(?:open|available)\s+(?:to\s+residents?\s+of|in))\s+((?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*)?(?:\s+and\s+)?)+)/i,
    );
    if (voidInMatch?.[1]) {
      const excludedNames = voidInMatch[1]
        .split(/[,]+/)
        .map((s) => s.replace(/^\s*and\s+/i, '').trim().toLowerCase());

      for (const stateName of excludedNames) {
        const abbr = STATE_ABBREVIATIONS[stateName];
        if (abbr) {
          restrictions.push(`excludes:US-${abbr}`);
        }
      }
    }

    return restrictions;
  }

  private extractEntryFrequency(text: string): string {
    const textLower = text.toLowerCase();

    if (/one\s+(?:\(\d+\)\s+)?entry\s+per\s+person/i.test(text)) {
      return 'once';
    }
    if (/daily\s+entry|one\s+entry\s+per\s+(?:day|24\s*hours?)/i.test(text)) {
      return 'daily';
    }
    if (/weekly\s+entry|one\s+entry\s+per\s+week/i.test(text)) {
      return 'weekly';
    }
    if (/unlimited\s+entr/i.test(text) || /no\s+limit\s+on\s+(?:the\s+number\s+of\s+)?entr/i.test(text)) {
      return 'unlimited';
    }
    if (textLower.includes('enter daily') || textLower.includes('enter once per day')) {
      return 'daily';
    }

    return 'once';
  }

  private extractMaxEntries(text: string): number | null {
    // "maximum of 5 entries per person"
    const maxMatch = text.match(
      /(?:maximum|max|limit)\s+(?:of\s+)?(\d+)\s+entr/i,
    );
    if (maxMatch?.[1]) {
      return parseInt(maxMatch[1], 10);
    }

    // "up to 10 entries"
    const upToMatch = text.match(/up\s+to\s+(\d+)\s+entr/i);
    if (upToMatch?.[1]) {
      return parseInt(upToMatch[1], 10);
    }

    return null;
  }

  private extractStartDate(text: string): string | null {
    // "begins on March 15, 2025" or "starting 03/15/2025"
    const patterns = [
      /(?:begins?|starts?|commences?)\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /(?:begins?|starts?|commences?)\s+(?:on\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/i,
      /(?:begins?|starts?|commences?)\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})/i,
      /(?:promotion|sweepstakes|contest)\s+(?:period\s+)?(?:begins?|starts?)\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const parsed = parseDate(match[1]);
        if (parsed) {
          return parsed.toISOString();
        }
      }
    }

    return null;
  }

  private extractEndDate(text: string): string | null {
    // "ends on March 15, 2025" or "ending 03/15/2025"
    const patterns = [
      /(?:ends?|closes?|concludes?|expires?)\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /(?:ends?|closes?|concludes?|expires?)\s+(?:on\s+)?(\d{1,2}\/\d{1,2}\/\d{4})/i,
      /(?:ends?|closes?|concludes?|expires?)\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})/i,
      /(?:through|until)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /(?:no later than|by)\s+(?:\d{1,2}:\d{2}\s*(?:AM|PM|ET|PT|CT|MT)\s+(?:on\s+)?)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const parsed = parseDate(match[1]);
        if (parsed) {
          return parsed.toISOString();
        }
      }
    }

    return null;
  }

  private extractExcludedAffiliations(text: string): string[] {
    const affiliations: string[] = [];

    // "employees of [Company] and their immediate family members"
    const employeeMatch = text.match(
      /employees?\s+(?:and\s+(?:their\s+)?(?:immediate\s+)?family\s+members?\s+)?of\s+((?:[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*(?:,?\s*(?:and\s+)?)?)+)/i,
    );
    if (employeeMatch?.[1]) {
      const companies = employeeMatch[1]
        .split(/,(?:\s*and\s+)?|\s+and\s+/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      affiliations.push(...companies);
    }

    // "affiliates, subsidiaries"
    if (/affiliates?|subsidiaries/i.test(text)) {
      if (!affiliations.includes('affiliates and subsidiaries')) {
        affiliations.push('affiliates and subsidiaries');
      }
    }

    return affiliations;
  }

  private detectPurchaseRequirement(text: string): boolean {
    const noPurchasePatterns = [
      /no\s+purchase\s+(?:or\s+payment\s+)?(?:is\s+)?(?:necessary|required)/i,
      /free\s+(?:method\s+of\s+)?entry/i,
      /purchase\s+(?:will\s+)?not\s+(?:increase|improve|enhance)/i,
    ];

    for (const pattern of noPurchasePatterns) {
      if (pattern.test(text)) {
        return false;
      }
    }

    const purchasePatterns = [
      /purchase\s+(?:is\s+)?required/i,
      /must\s+(?:make\s+a\s+)?purchase/i,
      /purchase\s+necessary/i,
    ];

    for (const pattern of purchasePatterns) {
      if (pattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  private detectVoidWhereProhibited(text: string): boolean {
    return /void\s+where\s+prohibited/i.test(text);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips HTML tags from a string and normalizes whitespace.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
