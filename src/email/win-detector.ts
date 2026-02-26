/**
 * Detects and processes win notification emails, extracting prize details,
 * claim URLs, and deadlines. Creates win records in the database.
 */

import { getLogger } from '../shared/logger.js';
import { eventBus } from '../shared/events.js';
import { generateId } from '../shared/crypto.js';
import type { WinEmail } from './email-monitor.js';

const logger = getLogger('email', { component: 'win-detector' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrizeDetails {
  description: string;
  estimatedValue: number;
  category: string;
  claimUrl: string;
  claimDeadline: string | null;
}

export interface Win {
  id: string;
  emailId: string;
  subject: string;
  from: string;
  prizeDescription: string;
  prizeValue: number;
  prizeCategory: string;
  claimUrl: string;
  claimDeadline: string | null;
  detectedAt: string;
}

// ---------------------------------------------------------------------------
// Prize value patterns
// ---------------------------------------------------------------------------

const DOLLAR_AMOUNT_REGEX = /\$\s*([\d,]+(?:\.\d{2})?)/g;

const PRIZE_VALUE_KEYWORDS: Record<string, { min: number; max: number }> = {
  'gift card': { min: 25, max: 500 },
  'iphone': { min: 800, max: 1500 },
  'ipad': { min: 400, max: 1200 },
  'macbook': { min: 1000, max: 3000 },
  'laptop': { min: 500, max: 2000 },
  'tv': { min: 300, max: 2000 },
  'car': { min: 20000, max: 80000 },
  'vacation': { min: 1000, max: 10000 },
  'trip': { min: 500, max: 5000 },
  'cash': { min: 100, max: 10000 },
  'xbox': { min: 300, max: 600 },
  'playstation': { min: 400, max: 600 },
  'airpods': { min: 100, max: 300 },
  'samsung': { min: 200, max: 1500 },
  'headphones': { min: 50, max: 400 },
  'smartwatch': { min: 200, max: 800 },
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  electronics: [
    'phone', 'iphone', 'samsung', 'tablet', 'ipad', 'laptop', 'macbook',
    'tv', 'television', 'headphones', 'airpods', 'xbox', 'playstation',
    'console', 'smartwatch', 'camera',
  ],
  cash: ['cash', 'money', 'check', 'paypal', 'venmo', 'payment'],
  gift_card: ['gift card', 'giftcard', 'gift certificate', 'store credit'],
  travel: ['vacation', 'trip', 'flight', 'hotel', 'cruise', 'getaway'],
  automotive: ['car', 'vehicle', 'truck', 'suv', 'motorcycle'],
  home: ['furniture', 'appliance', 'kitchen', 'home improvement'],
  other: [],
};

// ---------------------------------------------------------------------------
// WinDetector
// ---------------------------------------------------------------------------

export class WinDetector {
  /**
   * Processes a win notification email: extracts prize details, creates a
   * win record, and emits a 'win:detected' event.
   */
  processWinEmail(email: WinEmail): Win {
    logger.info(
      { emailId: email.emailId, subject: email.subject },
      'Processing win email',
    );

    const prizeDetails = this.extractPrizeDetails(
      email.prizeDetails || email.subject,
    );

    const win: Win = {
      id: generateId(),
      emailId: email.emailId,
      subject: email.subject,
      from: email.from,
      prizeDescription: prizeDetails.description || email.prizeDetails,
      prizeValue: prizeDetails.estimatedValue,
      prizeCategory: prizeDetails.category,
      claimUrl: email.claimUrl || prizeDetails.claimUrl,
      claimDeadline: email.claimDeadline || prizeDetails.claimDeadline,
      detectedAt: new Date().toISOString(),
    };

    eventBus.emit('win:detected', {
      entryId: '',
      prizeValue: win.prizeValue,
      prizeDescription: win.prizeDescription,
    });

    logger.info(
      {
        winId: win.id,
        prizeValue: win.prizeValue,
        category: win.prizeCategory,
        claimDeadline: win.claimDeadline,
      },
      'Win record created',
    );

    return win;
  }

  /**
   * Extracts prize details from an email body using regex patterns for
   * dollar amounts, prize keywords, and common claim URL formats.
   */
  extractPrizeDetails(emailBody: string): PrizeDetails {
    const description = this.extractDescription(emailBody);
    const estimatedValue = this.extractValue(emailBody);
    const category = this.detectCategory(emailBody);
    const claimUrl = this.extractClaimUrlFromBody(emailBody);
    const claimDeadline = this.extractClaimDeadline(emailBody);

    return {
      description,
      estimatedValue,
      category,
      claimUrl,
      claimDeadline,
    };
  }

  /**
   * Attempts to find a deadline date in the email body near keywords
   * like "deadline", "expires", "by", "before", or "must claim".
   */
  extractClaimDeadline(emailBody: string): string | null {
    if (!emailBody) {
      return null;
    }

    // Pattern: "deadline is March 15, 2025" or "by 03/15/2025" etc.
    const patterns = [
      /(?:deadline|expires?|by|before|must claim|respond by|no later than)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /(?:deadline|expires?|by|before|must claim|respond by|no later than)[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
      /(?:deadline|expires?|by|before|must claim|respond by|no later than)[:\s]+(\d{4}-\d{2}-\d{2})/i,
      /(?:within\s+)(\d+\s+(?:days?|business days?))/i,
    ];

    for (const pattern of patterns) {
      const match = emailBody.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractDescription(body: string): string {
    // Look for prize description near key phrases
    const descPatterns = [
      /(?:you(?:'ve)?\s+won|prize(?:\s+is)?|you(?:'ve)?\s+been\s+selected\s+(?:to\s+)?(?:win|receive))[:\s]+([^\n.!]{5,150})/i,
      /(?:winning|reward)[:\s]+([^\n.!]{5,150})/i,
      /(?:congratulations)[!,.]?\s+(?:you(?:'ve)?\s+won\s+)?([^\n.!]{5,100})/i,
    ];

    for (const pattern of descPatterns) {
      const match = body.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    // Fall back to extracting any dollar amount context
    const dollarContext = body.match(
      /[^.!?\n]*\$[\d,]+(?:\.\d{2})?[^.!?\n]*/,
    );
    if (dollarContext) {
      return dollarContext[0].trim();
    }

    return '';
  }

  private extractValue(body: string): number {
    // Direct dollar amount extraction
    const dollarMatches = [...body.matchAll(DOLLAR_AMOUNT_REGEX)];
    if (dollarMatches.length > 0) {
      // Take the largest value mentioned (likely the prize value)
      let maxValue = 0;
      for (const match of dollarMatches) {
        const value = parseFloat(match[1]!.replace(/,/g, ''));
        if (value > maxValue) {
          maxValue = value;
        }
      }
      return maxValue;
    }

    // Estimate from prize keywords
    const bodyLower = body.toLowerCase();
    for (const [keyword, range] of Object.entries(PRIZE_VALUE_KEYWORDS)) {
      if (bodyLower.includes(keyword)) {
        return (range.min + range.max) / 2;
      }
    }

    return 0;
  }

  private detectCategory(body: string): string {
    const bodyLower = body.toLowerCase();

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (category === 'other') continue;
      for (const keyword of keywords) {
        if (bodyLower.includes(keyword)) {
          return category;
        }
      }
    }

    return 'other';
  }

  private extractClaimUrlFromBody(body: string): string {
    const urlRegex = /https?:\/\/[^\s"'<>\])}]+/gi;
    const matches = body.match(urlRegex);
    if (!matches) {
      return '';
    }

    const claimPatterns = [/claim/i, /prize/i, /winner/i, /redeem/i, /collect/i];

    for (const url of matches) {
      if (claimPatterns.some((p) => p.test(url))) {
        return url.replace(/[.,;:!?)>\]]+$/, '');
      }
    }

    return '';
  }
}
