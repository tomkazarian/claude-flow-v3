/**
 * Gmail alias generator using dot tricks and plus addressing.
 *
 * Gmail ignores dots in the local part and supports +suffix addressing,
 * allowing a single Gmail account to receive email at many variations.
 * This module generates these aliases systematically for profile diversity.
 */

import { getLogger } from '../shared/logger.js';
import { ValidationError } from '../shared/errors.js';

const logger = getLogger('profile', { component: 'email-alias-generator' });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates unique Gmail aliases for a given base email address.
 *
 * Uses two techniques:
 * 1. Dot trick: inserts dots at various positions in the local part
 *    (Gmail ignores dots, so j.ohn@gmail.com goes to john@gmail.com)
 * 2. Plus addressing: appends +suffix to the local part
 *    (john+sweeps1@gmail.com goes to john@gmail.com)
 *
 * @param email - The base Gmail address (must be @gmail.com)
 * @param count - The number of aliases to generate
 * @returns An array of unique alias email addresses
 * @throws {ValidationError} If the email is not a Gmail address
 */
export function generateAliases(email: string, count: number): string[] {
  const trimmed = email.trim().toLowerCase();

  if (!isGmail(trimmed)) {
    throw new ValidationError(
      'Email must be a Gmail address (@gmail.com) for alias generation',
      'email',
      email,
    );
  }

  if (count <= 0) {
    return [];
  }

  const [localPart, domain] = splitEmail(trimmed);

  // Remove any existing dots from local part to get the canonical form
  const canonical = localPart.replace(/\./g, '');

  const aliases = new Set<string>();

  // Phase 1: Generate dot-trick aliases
  const dotVariations = generateDotVariations(canonical);
  for (const variation of dotVariations) {
    if (aliases.size >= count) break;
    const alias = `${variation}@${domain}`;
    // Skip the original email
    if (alias !== trimmed) {
      aliases.add(alias);
    }
  }

  // Phase 2: Generate plus-addressing aliases
  let plusCounter = 1;
  while (aliases.size < count) {
    const alias = `${canonical}+sweeps${plusCounter}@${domain}`;
    aliases.add(alias);
    plusCounter++;

    // Safety limit to prevent infinite loops
    if (plusCounter > count + 1000) {
      break;
    }
  }

  const result = [...aliases].slice(0, count);

  logger.debug(
    { baseEmail: trimmed, requestedCount: count, generatedCount: result.length },
    'Generated email aliases',
  );

  return result;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Validates that the email address is a Gmail address.
 */
function isGmail(email: string): boolean {
  return (
    email.endsWith('@gmail.com') ||
    email.endsWith('@googlemail.com')
  );
}

/**
 * Splits an email into local part and domain.
 */
function splitEmail(email: string): [string, string] {
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) {
    throw new ValidationError('Invalid email format', 'email', email);
  }
  return [email.slice(0, atIndex), email.slice(atIndex + 1)];
}

/**
 * Generates all possible dot-insertion variations of a local part.
 *
 * For a string of length n, there are 2^(n-1) possible dot placements
 * (each position between characters can have a dot or not).
 * For long usernames we cap the output to avoid combinatorial explosion.
 */
function generateDotVariations(canonical: string): string[] {
  if (canonical.length <= 1) {
    return [canonical];
  }

  const variations: string[] = [];
  const maxVariations = 500; // Cap to prevent memory issues
  const insertionPoints = canonical.length - 1;

  // If the combinatorial space is small enough, enumerate all variations
  if (insertionPoints <= 15) {
    const totalCombinations = 1 << insertionPoints; // 2^(n-1)

    for (let mask = 0; mask < totalCombinations; mask++) {
      if (variations.length >= maxVariations) break;

      let result = canonical[0]!;
      for (let i = 0; i < insertionPoints; i++) {
        if (mask & (1 << i)) {
          result += '.';
        }
        result += canonical[i + 1]!;
      }
      variations.push(result);
    }
  } else {
    // For very long usernames, generate a sampling of dot variations
    // Start with single-dot placements
    for (let i = 1; i < canonical.length; i++) {
      if (variations.length >= maxVariations) break;
      const result =
        canonical.slice(0, i) + '.' + canonical.slice(i);
      variations.push(result);
    }

    // Then double-dot placements
    for (let i = 1; i < canonical.length - 1; i++) {
      for (let j = i + 1; j < canonical.length; j++) {
        if (variations.length >= maxVariations) break;
        let result = canonical.slice(0, i) + '.';
        result += canonical.slice(i, j) + '.';
        result += canonical.slice(j);
        variations.push(result);
      }
      if (variations.length >= maxVariations) break;
    }
  }

  return variations;
}
