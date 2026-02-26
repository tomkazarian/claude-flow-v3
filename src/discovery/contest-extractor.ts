/**
 * Extract detailed contest information from an HTML page.
 *
 * Analyzes the full page content to detect contest type, end date,
 * prize info, entry method, CAPTCHA presence, age requirements,
 * geographic restrictions, and rules/terms links.
 */

import * as cheerio from 'cheerio';
import { getLogger } from '../shared/logger.js';
import { parseDate } from '../shared/utils.js';
import { CONTEST_TYPES, ENTRY_METHODS } from '../shared/constants.js';
import type { ContestDetails } from './types.js';

const log = getLogger('discovery', { component: 'contest-extractor' });

// ---------------------------------------------------------------------------
// Date extraction patterns
// ---------------------------------------------------------------------------

const DATE_PATTERNS: { regex: RegExp; group: number }[] = [
  { regex: /ends?\s*[:.]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i, group: 1 },
  { regex: /expires?\s*[:.]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i, group: 1 },
  { regex: /deadline\s*[:.]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i, group: 1 },
  { regex: /closes?\s*[:.]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i, group: 1 },
  { regex: /ends?\s*[:.]?\s*(\w+\s+\d{1,2},?\s+\d{4})/i, group: 1 },
  { regex: /expires?\s*[:.]?\s*(\w+\s+\d{1,2},?\s+\d{4})/i, group: 1 },
  { regex: /deadline\s*[:.]?\s*(\w+\s+\d{1,2},?\s+\d{4})/i, group: 1 },
  { regex: /closes?\s*[:.]?\s*(\w+\s+\d{1,2},?\s+\d{4})/i, group: 1 },
  { regex: /through\s+(\d{1,2}\/\d{1,2}\/\d{4})/i, group: 1 },
  { regex: /until\s+(\d{1,2}\/\d{1,2}\/\d{4})/i, group: 1 },
  { regex: /through\s+(\w+\s+\d{1,2},?\s+\d{4})/i, group: 1 },
  { regex: /until\s+(\w+\s+\d{1,2},?\s+\d{4})/i, group: 1 },
  { regex: /valid\s+(?:through|until|thru)\s+(\d{1,2}\/\d{1,2}\/\d{4})/i, group: 1 },
  { regex: /valid\s+(?:through|until|thru)\s+(\w+\s+\d{1,2},?\s+\d{4})/i, group: 1 },
  { regex: /(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:at|@)\s*\d{1,2}:\d{2}/i, group: 1 },
  { regex: /end\s*date\s*[:.]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i, group: 1 },
  { regex: /end\s*date\s*[:.]?\s*(\w+\s+\d{1,2},?\s+\d{4})/i, group: 1 },
];

// ---------------------------------------------------------------------------
// Contest type keywords
// ---------------------------------------------------------------------------

const TYPE_KEYWORDS: { keyword: string; type: string }[] = [
  { keyword: 'instant win', type: CONTEST_TYPES.INSTANT_WIN },
  { keyword: 'instant-win', type: CONTEST_TYPES.INSTANT_WIN },
  { keyword: 'instantwin', type: CONTEST_TYPES.INSTANT_WIN },
  { keyword: 'daily entry', type: CONTEST_TYPES.DAILY_ENTRY },
  { keyword: 'enter daily', type: CONTEST_TYPES.DAILY_ENTRY },
  { keyword: 'daily sweepstakes', type: CONTEST_TYPES.DAILY_ENTRY },
  { keyword: 'giveaway', type: CONTEST_TYPES.GIVEAWAY },
  { keyword: 'sweepstakes', type: CONTEST_TYPES.SWEEPSTAKES },
  { keyword: 'sweeps', type: CONTEST_TYPES.SWEEPSTAKES },
  { keyword: 'raffle', type: CONTEST_TYPES.SWEEPSTAKES },
  { keyword: 'contest', type: CONTEST_TYPES.SWEEPSTAKES },
  { keyword: 'win', type: CONTEST_TYPES.SWEEPSTAKES },
  { keyword: 'prize', type: CONTEST_TYPES.SWEEPSTAKES },
];

// ---------------------------------------------------------------------------
// CAPTCHA detection selectors and class patterns
// ---------------------------------------------------------------------------

const CAPTCHA_INDICATORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '.g-recaptcha',
  '.h-captcha',
  '[data-sitekey]',
  '#captcha',
  '.captcha',
  'iframe[src*="captcha"]',
  'iframe[src*="turnstile"]',
  '.cf-turnstile',
];

// ---------------------------------------------------------------------------
// US states for geo-restriction detection
// ---------------------------------------------------------------------------

const US_STATES = new Set([
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
  'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
  'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'new hampshire', 'new jersey', 'new mexico', 'new york',
  'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
  'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
  'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
]);

/**
 * Extract contest details from full HTML page content.
 */
export async function extractContestDetails(
  html: string,
  url: string,
): Promise<ContestDetails> {
  log.debug({ url }, 'Extracting contest details from page');

  const $ = cheerio.load(html);
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const lowerText = bodyText.toLowerCase();

  const type = detectContestType(lowerText);
  const endDate = extractEndDate(bodyText);
  const prizeDescription = extractPrizeInfo($, bodyText);
  const prizeValue = extractPrizeValue(bodyText);
  const entryMethod = detectEntryMethod($, lowerText);
  const entryFrequency = detectEntryFrequency(lowerText);
  const ageRequirement = detectAgeRequirement(lowerText);
  const geoRestrictions = detectGeoRestrictions(lowerText);
  const termsUrl = extractTermsUrl($, url);
  const hasCaptcha = detectCaptcha($);
  const requiresEmailConfirm = detectEmailConfirmation(lowerText);

  const details: ContestDetails = {
    type,
    endDate,
    prizeDescription,
    prizeValue,
    entryMethod,
    entryFrequency,
    ageRequirement,
    geoRestrictions,
    termsUrl,
    hasCaptcha,
    requiresEmailConfirm,
  };

  log.debug({ url, type, hasCaptcha, entryMethod }, 'Contest details extracted');
  return details;
}

/**
 * Detect contest type from page text keywords.
 */
function detectContestType(lowerText: string): string {
  for (const { keyword, type } of TYPE_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return type;
    }
  }
  return CONTEST_TYPES.SWEEPSTAKES;
}

/**
 * Extract end date from page text using multiple regex patterns.
 */
function extractEndDate(bodyText: string): Date | null {
  for (const { regex, group } of DATE_PATTERNS) {
    const match = bodyText.match(regex);
    if (match?.[group]) {
      const parsed = parseDate(match[group]);
      if (parsed) {
        return parsed;
      }
    }
  }
  return null;
}

/**
 * Extract prize information from the page.
 */
function extractPrizeInfo($: cheerio.CheerioAPI, bodyText: string): string {
  // Try structured data first
  const prizeSelectors = [
    '.prize', '.prize-info', '.prize-description', '.prize-value',
    '[class*="prize"]', '[id*="prize"]',
    '.reward', '.reward-info',
  ];

  for (const sel of prizeSelectors) {
    const el = $(sel);
    if (el.length > 0) {
      const text = el.first().text().trim();
      if (text.length > 5 && text.length < 500) {
        return text;
      }
    }
  }

  // Try extracting from body text
  const prizeMatch = bodyText.match(/(?:grand\s+)?prize[:\s]+(.{10,200}?)(?:\.|!|\n)/i);
  if (prizeMatch?.[1]) {
    return prizeMatch[1].trim();
  }

  const winMatch = bodyText.match(/win\s+(?:a\s+)?(.{10,200}?)(?:\.|!|\n)/i);
  if (winMatch?.[1]) {
    return winMatch[1].trim();
  }

  return '';
}

/**
 * Extract the monetary prize value from text.
 */
function extractPrizeValue(bodyText: string): number | null {
  // Look for dollar amounts
  const amounts: number[] = [];
  const dollarRegex = /\$\s*([\d,]+(?:\.\d{2})?)/g;
  let match: RegExpExecArray | null;

  while ((match = dollarRegex.exec(bodyText)) !== null) {
    const raw = match[1]?.replace(/,/g, '') ?? '';
    const value = parseFloat(raw);
    if (!isNaN(value) && value > 0 && value < 10_000_000) {
      amounts.push(value);
    }
  }

  // Also check for word-form amounts
  const wordAmountMatch = bodyText.match(/valued?\s+(?:at|up to)\s+\$?([\d,]+)/i);
  if (wordAmountMatch?.[1]) {
    const value = parseFloat(wordAmountMatch[1].replace(/,/g, ''));
    if (!isNaN(value) && value > 0) {
      amounts.push(value);
    }
  }

  if (amounts.length === 0) {
    return null;
  }

  // Return the largest amount found (likely the grand prize)
  return Math.max(...amounts);
}

/**
 * Detect entry method by analyzing the page structure.
 */
function detectEntryMethod($: cheerio.CheerioAPI, lowerText: string): string {
  // Check for form elements
  const hasForms = $('form').length > 0;
  const hasInputs = $('input[type="text"], input[type="email"]').length > 0;

  if (hasForms && hasInputs) {
    return ENTRY_METHODS.FORM;
  }

  // Check for social media entry patterns
  if (lowerText.includes('follow us') || lowerText.includes('follow @')) {
    return ENTRY_METHODS.SOCIAL_FOLLOW;
  }
  if (lowerText.includes('share this') || lowerText.includes('share on')) {
    return ENTRY_METHODS.SOCIAL_SHARE;
  }
  if (lowerText.includes('like us') || lowerText.includes('like our')) {
    return ENTRY_METHODS.SOCIAL_LIKE;
  }
  if (lowerText.includes('retweet') || lowerText.includes('rt to win')) {
    return ENTRY_METHODS.SOCIAL_RETWEET;
  }
  if (lowerText.includes('comment') || lowerText.includes('leave a reply')) {
    return ENTRY_METHODS.SOCIAL_COMMENT;
  }

  // Check for email/newsletter signup
  if (lowerText.includes('subscribe') || lowerText.includes('newsletter') || lowerText.includes('sign up')) {
    return ENTRY_METHODS.NEWSLETTER;
  }
  if (lowerText.includes('email') && lowerText.includes('enter')) {
    return ENTRY_METHODS.EMAIL;
  }

  // Check for referral
  if (lowerText.includes('refer a friend') || lowerText.includes('referral')) {
    return ENTRY_METHODS.REFERRAL_LINK;
  }

  // Check for survey
  if (lowerText.includes('survey') || lowerText.includes('questionnaire')) {
    return ENTRY_METHODS.SURVEY;
  }

  // Check for video watch
  if (lowerText.includes('watch the video') || lowerText.includes('watch to')) {
    return ENTRY_METHODS.VIDEO_WATCH;
  }

  // Default to form if we found any form at all
  if (hasForms) {
    return ENTRY_METHODS.FORM;
  }

  return ENTRY_METHODS.FORM;
}

/**
 * Detect how frequently one can enter the contest.
 */
function detectEntryFrequency(lowerText: string): string {
  if (lowerText.includes('one entry per day') || lowerText.includes('enter daily') ||
      lowerText.includes('once per day') || lowerText.includes('daily entry')) {
    return 'daily';
  }
  if (lowerText.includes('one entry per week') || lowerText.includes('once per week') ||
      lowerText.includes('weekly entry')) {
    return 'weekly';
  }
  if (lowerText.includes('one entry per person') || lowerText.includes('one entry only') ||
      lowerText.includes('single entry') || lowerText.includes('one time entry') ||
      lowerText.includes('limit one entry')) {
    return 'once';
  }
  if (lowerText.includes('unlimited entries') || lowerText.includes('enter as many times')) {
    return 'unlimited';
  }
  if (lowerText.includes('one entry per month') || lowerText.includes('monthly')) {
    return 'monthly';
  }

  return 'once';
}

/**
 * Detect minimum age requirement from page text.
 */
function detectAgeRequirement(lowerText: string): number | null {
  // Check for explicit age statements
  const ageMatch = lowerText.match(/(?:must be|at least|minimum age|age)\s*(?:of\s+)?(\d{2})\s*(?:years?\s*old|or older|\+)/i);
  if (ageMatch?.[1]) {
    const age = parseInt(ageMatch[1], 10);
    if (age >= 13 && age <= 65) {
      return age;
    }
  }

  // Check for common age declarations
  if (lowerText.includes('18 or older') || lowerText.includes('18+') || lowerText.includes('18 years')) {
    return 18;
  }
  if (lowerText.includes('21 or older') || lowerText.includes('21+') || lowerText.includes('21 years')) {
    return 21;
  }
  if (lowerText.includes('13 or older') || lowerText.includes('13+') || lowerText.includes('13 years')) {
    return 13;
  }

  return null;
}

/**
 * Detect geographic restrictions from the rules text.
 */
function detectGeoRestrictions(lowerText: string): string[] {
  const restrictions: string[] = [];

  // Check for US-only
  if (lowerText.includes('united states only') || lowerText.includes('u.s. only') ||
      lowerText.includes('us residents only') || lowerText.includes('open to legal residents of the united states')) {
    restrictions.push('US');
  }

  // Check for specific country restrictions
  if (lowerText.includes('canada only') || lowerText.includes('canadian residents')) {
    restrictions.push('CA');
  }
  if (lowerText.includes('uk only') || lowerText.includes('united kingdom')) {
    restrictions.push('UK');
  }

  // Check for US state exclusions
  const excludeMatch = lowerText.match(
    /(?:exclud(?:ing|es?)|except|not (?:valid|available|open) in)\s+([^.]+)/i,
  );
  if (excludeMatch?.[1]) {
    const excludeText = excludeMatch[1].toLowerCase();
    for (const state of US_STATES) {
      if (excludeText.includes(state)) {
        restrictions.push(`exclude:${state}`);
      }
    }
  }

  // Check for "50 states" or "48 contiguous"
  if (lowerText.includes('50 states') || lowerText.includes('all 50 states')) {
    restrictions.push('US:all-50');
  }
  if (lowerText.includes('48 contiguous') || lowerText.includes('continental united states')) {
    restrictions.push('US:48-contiguous');
  }

  return restrictions;
}

/**
 * Extract the official rules/terms URL from the page.
 */
function extractTermsUrl($: cheerio.CheerioAPI, pageUrl: string): string | null {
  const termsSelectors = [
    'a[href*="rules"]',
    'a[href*="terms"]',
    'a[href*="official-rules"]',
    'a[href*="officialrules"]',
    'a[href*="conditions"]',
    'a[href*="tos"]',
  ];

  for (const sel of termsSelectors) {
    const el = $(sel);
    if (el.length > 0) {
      const href = el.first().attr('href');
      if (href) {
        if (href.startsWith('http')) {
          return href;
        }
        try {
          return new URL(href, pageUrl).toString();
        } catch {
          continue;
        }
      }
    }
  }

  // Check for links with "rules" or "terms" in the anchor text
  const textLinks = $('a').filter((_i, el) => {
    const text = $(el).text().toLowerCase();
    return text.includes('official rules') || text.includes('terms and conditions') ||
           text.includes('terms & conditions') || text.includes('contest rules') ||
           text.includes('sweepstakes rules');
  });

  if (textLinks.length > 0) {
    const href = textLinks.first().attr('href');
    if (href) {
      if (href.startsWith('http')) {
        return href;
      }
      try {
        return new URL(href, pageUrl).toString();
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Detect CAPTCHA presence on the page.
 */
function detectCaptcha($: cheerio.CheerioAPI): boolean {
  for (const selector of CAPTCHA_INDICATORS) {
    if ($(selector).length > 0) {
      return true;
    }
  }

  // Check page HTML for captcha-related script sources
  const html = $.html().toLowerCase();
  if (html.includes('recaptcha') || html.includes('hcaptcha') || html.includes('turnstile')) {
    return true;
  }

  return false;
}

/**
 * Detect if email confirmation is required for entry.
 */
function detectEmailConfirmation(lowerText: string): boolean {
  const indicators = [
    'confirm your email',
    'confirmation email',
    'verify your email',
    'email verification',
    'check your email',
    'check your inbox',
    'click the link in',
    'confirm your entry',
    'confirmation link',
    'double opt-in',
  ];

  return indicators.some((indicator) => lowerText.includes(indicator));
}
