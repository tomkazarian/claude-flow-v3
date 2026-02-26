/**
 * Legitimacy scoring for discovered contests.
 *
 * Evaluates whether a contest is likely legitimate based on a set
 * of weighted heuristic factors. Used to filter out scams, phishing,
 * and low-quality entries before they enter the entry pipeline.
 */

import { getLogger } from '../shared/logger.js';
import { extractDomain } from '../shared/utils.js';
import type { RawContest, LegitimacyReport, LegitimacyFactor } from './types.js';

const log = getLogger('discovery', { component: 'legitimacy-scorer' });

/** Minimum score required to pass the legitimacy check. */
const PASS_THRESHOLD = 0.35;

// ---------------------------------------------------------------------------
// Known-good and known-bad domain lists
// ---------------------------------------------------------------------------

const KNOWN_LEGITIMATE_SOURCES = new Set([
  'sweepstakesadvantage.com',
  'online-sweepstakes.com',
  'sweepstakesfanatics.com',
  'contestgirl.com',
  'sweetiessweeps.com',
  'thebalanceeveryday.com',
  'lovefrugal.com',
  'giveawaymonkey.com',
  'winzily.com',
  'truesweepstakes.com',
  'slickdeals.net',
]);

const KNOWN_BRANDS = new Set([
  'coca-cola', 'pepsi', 'amazon', 'walmart', 'target', 'costco',
  'starbucks', 'mcdonalds', 'nike', 'adidas', 'apple', 'samsung',
  'microsoft', 'google', 'disney', 'hershey', 'nestle', 'kraft',
  'procter', 'p&g', 'unilever', 'johnson', 'kellogg', 'general mills',
  'ford', 'toyota', 'honda', 'chevrolet', 'bmw', 'netflix',
  'sony', 'lg', 'dell', 'hp', 'intel', 'visa', 'mastercard',
  'southwest', 'delta', 'united', 'marriott', 'hilton', 'hyatt',
  'kroger', 'albertsons', 'publix', 'wegmans', 'whole foods',
]);

const SCAM_DOMAINS = new Set([
  'prizegrab.com',
  'freebiejeebies.co.uk',
  'instantrewards.net',
  'freeprizes.co',
  'claimyourreward.net',
  'winnow-prizes.com',
  'mega-prize-center.com',
  'exclusive-rewards-hub.com',
  'instant-cash-prize.com',
  'free-iphone-winner.com',
]);

const SUSPICIOUS_KEYWORDS = [
  'guaranteed win',
  'claim your prize now',
  'act now',
  'you have been selected',
  'you are a winner',
  'congratulations you won',
  'limited time only',
  'exclusive invitation',
  'wire transfer',
  'send money',
  'processing fee',
  'pay to claim',
  'social security',
  'bank account number',
  'credit card required',
  'send payment',
];

const PAYMENT_KEYWORDS = [
  'payment required',
  'pay to enter',
  'processing fee',
  'entry fee',
  'shipping and handling fee',
  'pay for shipping',
  'credit card to enter',
  'send money to claim',
];

const EXCESSIVE_PERSONAL_INFO_KEYWORDS = [
  'social security',
  'ssn',
  'bank account',
  'routing number',
  'credit card number',
  'passport number',
  'driver license number',
  'mother maiden name',
  'pin number',
];

export class LegitimacyScorer {
  /**
   * Score a contest's legitimacy on a 0-1 scale.
   * Returns just the numeric score for quick filtering.
   */
  score(contest: RawContest): number {
    const report = this.evaluate(contest);
    return report.score;
  }

  /**
   * Perform a full legitimacy evaluation returning a detailed report.
   */
  evaluate(contest: RawContest): LegitimacyReport {
    const factors: LegitimacyFactor[] = [];
    let totalScore = 0;

    const url = contest.url;
    const domain = extractDomain(url);
    const combined = `${contest.title} ${contest.prizeDescription} ${contest.sponsor}`.toLowerCase();

    // Factor 1: Known scam domain check (instant disqualification)
    if (SCAM_DOMAINS.has(domain)) {
      factors.push({
        name: 'scam-domain',
        score: -1.0,
        reason: `Domain "${domain}" is on the known scam list`,
      });
      return this.buildReport(factors, -1.0);
    }

    // Factor 2: Known legitimate source (+0.3)
    const sourceDomain = extractDomain(contest.source);
    if (KNOWN_LEGITIMATE_SOURCES.has(sourceDomain) || KNOWN_LEGITIMATE_SOURCES.has(domain)) {
      factors.push({
        name: 'known-source',
        score: 0.3,
        reason: 'Contest found on a known legitimate aggregator',
      });
      totalScore += 0.3;
    }

    // Factor 3: Valid end date (+0.1)
    if (contest.endDate && contest.endDate.trim().length > 0) {
      factors.push({
        name: 'has-end-date',
        score: 0.1,
        reason: 'Contest has a stated end date',
      });
      totalScore += 0.1;
    }

    // Factor 4: Known brand sponsor (+0.15)
    const sponsorLower = contest.sponsor.toLowerCase();
    const isKnownBrand = Array.from(KNOWN_BRANDS).some(
      (brand) => sponsorLower.includes(brand) || combined.includes(brand),
    );
    if (isKnownBrand) {
      factors.push({
        name: 'known-brand',
        score: 0.15,
        reason: 'Sponsor appears to be a recognized brand',
      });
      totalScore += 0.15;
    }

    // Factor 5: HTTPS (+0.05)
    if (url.startsWith('https://')) {
      factors.push({
        name: 'https',
        score: 0.05,
        reason: 'URL uses HTTPS',
      });
      totalScore += 0.05;
    }

    // Factor 6: Domain quality heuristic (+0.1)
    // Legitimate domains tend to be shorter with recognizable TLDs
    const domainScore = this.scoreDomainQuality(domain);
    if (domainScore > 0) {
      factors.push({
        name: 'domain-quality',
        score: domainScore,
        reason: `Domain "${domain}" has quality score ${domainScore.toFixed(2)}`,
      });
      totalScore += domainScore;
    }

    // Factor 7: No excessive personal info requests (+0.1)
    const hasExcessiveInfo = EXCESSIVE_PERSONAL_INFO_KEYWORDS.some(
      (keyword) => combined.includes(keyword),
    );
    if (!hasExcessiveInfo) {
      factors.push({
        name: 'no-excessive-info',
        score: 0.1,
        reason: 'No requests for sensitive personal information detected',
      });
      totalScore += 0.1;
    } else {
      factors.push({
        name: 'excessive-info',
        score: -0.3,
        reason: 'Requests for sensitive personal information (SSN, bank account, etc.)',
      });
      totalScore -= 0.3;
    }

    // Factor 8: Suspicious keywords (-0.3 each, up to 3)
    let suspiciousCount = 0;
    for (const keyword of SUSPICIOUS_KEYWORDS) {
      if (combined.includes(keyword)) {
        suspiciousCount++;
        factors.push({
          name: 'suspicious-keyword',
          score: -0.3,
          reason: `Suspicious keyword detected: "${keyword}"`,
        });
        totalScore -= 0.3;

        if (suspiciousCount >= 3) {
          break;
        }
      }
    }

    // Factor 9: Payment required to enter (-0.5)
    const requiresPayment = PAYMENT_KEYWORDS.some(
      (keyword) => combined.includes(keyword),
    );
    if (requiresPayment) {
      factors.push({
        name: 'requires-payment',
        score: -0.5,
        reason: 'Contest appears to require payment to enter',
      });
      totalScore -= 0.5;
    }

    // Factor 10: Has terms/rules URL (inferred from text) (+0.1)
    if (
      combined.includes('official rules') ||
      combined.includes('terms and conditions') ||
      combined.includes('see rules') ||
      combined.includes('contest rules')
    ) {
      factors.push({
        name: 'has-terms-reference',
        score: 0.1,
        reason: 'References official rules or terms',
      });
      totalScore += 0.1;
    }

    // Clamp score to [0, 1]
    totalScore = Math.max(0, Math.min(1, totalScore));

    return this.buildReport(factors, totalScore);
  }

  /**
   * Heuristic score for domain quality based on structure.
   */
  private scoreDomainQuality(domain: string): number {
    let score = 0;

    // Common legitimate TLDs
    const goodTlds = ['.com', '.org', '.net', '.edu', '.gov', '.co'];
    const hasgoodTld = goodTlds.some((tld) => domain.endsWith(tld));
    if (hasgoodTld) {
      score += 0.05;
    }

    // Shorter domains tend to be more legitimate
    if (domain.length < 20) {
      score += 0.03;
    }

    // Domains with many hyphens or numbers are often suspicious
    const hyphenCount = (domain.match(/-/g) ?? []).length;
    const digitCount = (domain.match(/\d/g) ?? []).length;
    if (hyphenCount > 2) {
      score -= 0.05;
    }
    if (digitCount > 3) {
      score -= 0.05;
    }

    return Math.max(0, Math.min(0.1, score));
  }

  /**
   * Build the final legitimacy report.
   */
  private buildReport(
    factors: LegitimacyFactor[],
    rawScore: number,
  ): LegitimacyReport {
    const score = Math.max(0, Math.min(1, rawScore));
    const passed = score >= PASS_THRESHOLD;

    const positiveCount = factors.filter((f) => f.score > 0).length;
    const negativeCount = factors.filter((f) => f.score < 0).length;

    let summary: string;
    if (score <= 0) {
      summary = 'Contest is almost certainly a scam or fraudulent entry.';
    } else if (score < PASS_THRESHOLD) {
      summary = `Contest scored ${score.toFixed(2)} which is below the ${PASS_THRESHOLD} threshold. ${negativeCount} red flag(s) detected.`;
    } else if (score < 0.6) {
      summary = `Contest scored ${score.toFixed(2)} and passed with caution. ${positiveCount} positive and ${negativeCount} negative indicator(s).`;
    } else {
      summary = `Contest scored ${score.toFixed(2)} and appears legitimate. ${positiveCount} positive indicator(s).`;
    }

    log.debug({ score, passed, factorCount: factors.length }, summary);

    return { score, factors, passed, summary };
  }
}
