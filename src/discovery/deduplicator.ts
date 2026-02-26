/**
 * Contest deduplication engine.
 *
 * Prevents the same contest from being stored or processed multiple times
 * by checking exact URL matches, normalized URL matches, title similarity
 * (Levenshtein distance), and content hashes.
 */

import { createHash } from 'node:crypto';
import { getLogger } from '../shared/logger.js';
import { normalizeUrl } from '../shared/utils.js';
import type { RawContest, DeduplicationResult } from './types.js';

const log = getLogger('discovery', { component: 'deduplicator' });

/** Threshold above which two titles are considered a match (0-1). */
const TITLE_SIMILARITY_THRESHOLD = 0.85;

export class ContestDeduplicator {
  /** In-memory store of known contest URLs (normalized). */
  private readonly knownUrls = new Set<string>();
  /** In-memory map of content hashes to contest IDs. */
  private readonly contentHashes = new Map<string, string>();
  /** In-memory map of normalized titles to contest IDs. */
  private readonly knownTitles = new Map<string, string>();

  /**
   * Register an existing contest into the deduplication index.
   * Call this for all contests already in the database at startup.
   */
  registerExisting(id: string, url: string, title: string, sponsor: string): void {
    const normalized = normalizeUrl(url);
    this.knownUrls.add(normalized);

    const hash = this.generateContentHash(url, title, sponsor);
    this.contentHashes.set(hash, id);

    const normalizedTitle = this.normalizeTitle(title);
    if (normalizedTitle.length > 0) {
      this.knownTitles.set(normalizedTitle, id);
    }
  }

  /**
   * Check whether a contest is a duplicate of one already known.
   */
  async isDuplicate(contest: RawContest): Promise<DeduplicationResult> {
    // 1. Exact URL match
    if (this.knownUrls.has(contest.url)) {
      log.debug({ url: contest.url }, 'Duplicate detected: exact URL match');
      return { isDuplicate: true, method: 'exact-url' };
    }

    // 2. Normalized URL match
    const normalizedUrl = normalizeUrl(contest.url);
    if (this.knownUrls.has(normalizedUrl)) {
      log.debug({ url: contest.url }, 'Duplicate detected: normalized URL match');
      return { isDuplicate: true, method: 'normalized-url' };
    }

    // 3. Content hash match
    const hash = this.generateContentHash(contest.url, contest.title, contest.sponsor);
    const existingByHash = this.contentHashes.get(hash);
    if (existingByHash) {
      log.debug({ url: contest.url, existingId: existingByHash }, 'Duplicate detected: content hash match');
      return { isDuplicate: true, existingId: existingByHash, method: 'content-hash' };
    }

    // 4. Title similarity match
    const normalizedTitle = this.normalizeTitle(contest.title);
    if (normalizedTitle.length > 0) {
      for (const [knownTitle, knownId] of this.knownTitles) {
        const similarity = this.computeSimilarity(normalizedTitle, knownTitle);
        if (similarity >= TITLE_SIMILARITY_THRESHOLD) {
          log.debug(
            { url: contest.url, similarity, existingId: knownId },
            'Duplicate detected: title similarity match',
          );
          return { isDuplicate: true, existingId: knownId, method: 'title-similarity' };
        }
      }
    }

    return { isDuplicate: false };
  }

  /**
   * Mark a contest as known after it has been stored.
   */
  markKnown(id: string, contest: RawContest): void {
    const normalizedUrl = normalizeUrl(contest.url);
    this.knownUrls.add(contest.url);
    this.knownUrls.add(normalizedUrl);

    const hash = this.generateContentHash(contest.url, contest.title, contest.sponsor);
    this.contentHashes.set(hash, id);

    const normalizedTitle = this.normalizeTitle(contest.title);
    if (normalizedTitle.length > 0) {
      this.knownTitles.set(normalizedTitle, id);
    }
  }

  /**
   * Generate a stable external ID from URL and sponsor using SHA-256.
   * This is useful as a deduplication key across different crawl sessions.
   */
  generateExternalId(url: string, sponsor: string): string {
    const normalized = normalizeUrl(url).toLowerCase();
    const normalizedSponsor = sponsor.toLowerCase().trim();
    const input = `${normalized}|${normalizedSponsor}`;
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }

  /**
   * Get statistics about the deduplication index.
   */
  getStats(): { knownUrls: number; contentHashes: number; knownTitles: number } {
    return {
      knownUrls: this.knownUrls.size,
      contentHashes: this.contentHashes.size,
      knownTitles: this.knownTitles.size,
    };
  }

  /**
   * Clear the deduplication index.
   */
  clear(): void {
    this.knownUrls.clear();
    this.contentHashes.clear();
    this.knownTitles.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate a SHA-256 hash from URL, title, and sponsor for content-based dedup.
   */
  private generateContentHash(url: string, title: string, sponsor: string): string {
    const normalized = [
      normalizeUrl(url).toLowerCase(),
      this.normalizeTitle(title),
      sponsor.toLowerCase().trim(),
    ].join('|');

    return createHash('sha256').update(normalized, 'utf8').digest('hex');
  }

  /**
   * Normalize a title for comparison: lowercase, remove extra whitespace,
   * strip common filler words, and remove punctuation.
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\b(the|a|an|and|or|to|for|of|in|on|at|by|with|from|sweepstakes|giveaway|contest|win)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Compute the normalized Levenshtein similarity between two strings (0-1).
   * 1 means identical, 0 means completely different.
   */
  private computeSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const distance = this.levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length);
    return 1 - distance / maxLen;
  }

  /**
   * Compute Levenshtein edit distance between two strings.
   * Uses the classic dynamic programming approach with O(min(m,n)) space.
   */
  private levenshteinDistance(a: string, b: string): number {
    // Ensure a is the shorter string for space optimization
    if (a.length > b.length) {
      [a, b] = [b, a];
    }

    const aLen = a.length;
    const bLen = b.length;

    // Previous and current rows of the DP table
    let prev = new Array<number>(aLen + 1);
    let curr = new Array<number>(aLen + 1);

    // Initialize the base row
    for (let j = 0; j <= aLen; j++) {
      prev[j] = j;
    }

    for (let i = 1; i <= bLen; i++) {
      curr[0] = i;

      for (let j = 1; j <= aLen; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
        curr[j] = Math.min(
          (prev[j] ?? 0) + 1,           // deletion
          (curr[j - 1] ?? 0) + 1,       // insertion
          (prev[j - 1] ?? 0) + cost,    // substitution
        );
      }

      [prev, curr] = [curr, prev];
    }

    return prev[aLen] ?? 0;
  }
}
