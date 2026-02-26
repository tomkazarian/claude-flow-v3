/**
 * Extracts verification codes from SMS message bodies.
 *
 * Supports a wide range of common code formats used by sweepstakes
 * platforms, authentication systems, and verification services.
 */

import { getLogger } from '../shared/logger.js';

const logger = getLogger('sms', { component: 'code-extractor' });

// ---------------------------------------------------------------------------
// Patterns ordered from most specific to least specific
// ---------------------------------------------------------------------------

const CODE_PATTERNS: { regex: RegExp; group: number; label: string }[] = [
  // "Your code is: 123456"
  {
    regex: /your\s+(?:verification\s+)?code\s+is[:\s]+(\d{4,8})/i,
    group: 1,
    label: 'your-code-is',
  },
  // "Verification code: 123456"
  {
    regex: /verification\s+code[:\s]+(\d{4,8})/i,
    group: 1,
    label: 'verification-code',
  },
  // "Confirmation code: 123456"
  {
    regex: /confirmation\s+code[:\s]+(\d{4,8})/i,
    group: 1,
    label: 'confirmation-code',
  },
  // "Security code: 123456"
  {
    regex: /security\s+code[:\s]+(\d{4,8})/i,
    group: 1,
    label: 'security-code',
  },
  // "OTP: 123456" or "One-time password: 123456"
  {
    regex: /(?:OTP|one[- ]time\s+(?:password|passcode|code))[:\s]+(\d{4,8})/i,
    group: 1,
    label: 'otp',
  },
  // "Enter 123456 to verify"
  {
    regex: /enter\s+(\d{4,8})\s+to\s+(?:verify|confirm|complete|validate)/i,
    group: 1,
    label: 'enter-to-verify',
  },
  // "Use 123456 as your"
  {
    regex: /use\s+(\d{4,8})\s+as\s+your/i,
    group: 1,
    label: 'use-as-your',
  },
  // "PIN: 123456" or "PIN is 123456"
  {
    regex: /PIN[:\s]+(?:is\s+)?(\d{4,8})/i,
    group: 1,
    label: 'pin',
  },
  // "Code: 123456"
  {
    regex: /code[:\s]+(\d{4,8})/i,
    group: 1,
    label: 'code-colon',
  },
  // Alphanumeric codes: "Your code is: ABC123"
  {
    regex: /your\s+(?:verification\s+)?code\s+is[:\s]+([A-Z0-9]{4,8})/i,
    group: 1,
    label: 'alphanumeric-code',
  },
  // Standalone 4-8 digit code (least specific, last resort)
  // Must be preceded by a word boundary and not part of a phone number
  {
    regex: /(?:^|[\s:])(\d{4,8})(?:[\s.]|$)/,
    group: 1,
    label: 'standalone-digits',
  },
];

// Patterns that indicate the number is NOT a verification code
const FALSE_POSITIVE_PATTERNS = [
  /\d{3}[-.]\d{3}[-.]\d{4}/, // Phone numbers
  /\d{5}(?:-\d{4})?/, // ZIP codes when preceded by state abbreviation
  /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i, // Dates
  /\d{1,2}:\d{2}/, // Times
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempts to extract a verification code from an SMS message body.
 *
 * Tries patterns in order from most specific ("Your code is: 123456")
 * to least specific (standalone digit groups). Returns null if no
 * code-like pattern is found.
 *
 * @param messageBody - The raw text of the SMS message
 * @returns The extracted code string, or null if none found
 */
export function extractCode(messageBody: string): string | null {
  if (!messageBody || messageBody.trim().length === 0) {
    return null;
  }

  const cleaned = messageBody.trim();

  for (const { regex, group, label } of CODE_PATTERNS) {
    const match = cleaned.match(regex);
    if (match?.[group]) {
      const candidate = match[group]!;

      // Check for false positives
      if (isFalsePositive(cleaned, candidate)) {
        logger.debug(
          { pattern: label, candidate },
          'Code candidate rejected as false positive',
        );
        continue;
      }

      logger.debug(
        { pattern: label, codeLength: candidate.length },
        'Verification code extracted',
      );
      return candidate;
    }
  }

  logger.debug(
    { bodyLength: cleaned.length },
    'No verification code found in message',
  );
  return null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether a candidate code is likely a false positive (e.g. a
 * phone number, ZIP code, date, or time embedded in the message).
 */
function isFalsePositive(fullBody: string, candidate: string): boolean {
  for (const pattern of FALSE_POSITIVE_PATTERNS) {
    const match = fullBody.match(pattern);
    if (match && match[0]?.includes(candidate)) {
      return true;
    }
  }
  return false;
}
