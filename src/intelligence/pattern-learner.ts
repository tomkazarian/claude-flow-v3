/**
 * Pattern learner for contest entry form mappings.
 *
 * Records successful form field mappings and uses them to pre-populate
 * entry strategies for new contests, especially ones on the same domain.
 *
 * Data is stored in-memory with periodic persistence to the database.
 */

import { eq, sql } from 'drizzle-orm';
import { getLogger } from '../shared/logger.js';
import { extractDomain } from '../shared/utils.js';
import { getDb, schema } from '../db/index.js';

const log = getLogger('queue', { component: 'pattern-learner' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MappingRecord {
  /** Contest URL this mapping was learned from. */
  contestUrl: string;
  /** Domain extracted from the contest URL. */
  domain: string;
  /** The successful field mapping (CSS selector -> profile field). */
  formMapping: Record<string, string>;
  /** Number of times this mapping has been used successfully. */
  successCount: number;
  /** When this mapping was last used. */
  lastUsedAt: number;
}

// ---------------------------------------------------------------------------
// PatternLearner
// ---------------------------------------------------------------------------

export class PatternLearner {
  /**
   * Maps exact contest URL to its learned mapping.
   */
  private readonly exactMappings = new Map<string, MappingRecord>();

  /**
   * Maps domain to an array of learned mappings for that domain.
   * Used for fuzzy matching when an exact URL match is not found.
   */
  private readonly domainMappings = new Map<string, MappingRecord[]>();

  /**
   * Records a successful entry form mapping for future reuse.
   *
   * @param contestUrl - The URL of the contest that was successfully entered.
   * @param formMapping - A map of CSS selectors to the profile field names that worked.
   */
  recordSuccess(
    contestUrl: string,
    formMapping: Record<string, string>,
  ): void {
    if (!contestUrl || Object.keys(formMapping).length === 0) {
      log.debug({ contestUrl }, 'Skipping empty mapping record');
      return;
    }

    const domain = extractDomain(contestUrl);

    // Update or create exact mapping
    const existing = this.exactMappings.get(contestUrl);
    if (existing) {
      existing.formMapping = { ...existing.formMapping, ...formMapping };
      existing.successCount += 1;
      existing.lastUsedAt = Date.now();
    } else {
      const record: MappingRecord = {
        contestUrl,
        domain,
        formMapping,
        successCount: 1,
        lastUsedAt: Date.now(),
      };
      this.exactMappings.set(contestUrl, record);

      // Add to domain mappings
      const domainRecords = this.domainMappings.get(domain) ?? [];
      domainRecords.push(record);
      this.domainMappings.set(domain, domainRecords);
    }

    // Persist to database
    this.persistMapping(contestUrl, formMapping).catch((err) => {
      log.warn({ err, contestUrl }, 'Failed to persist mapping to database');
    });

    log.info(
      {
        contestUrl,
        domain,
        fieldCount: Object.keys(formMapping).length,
        successCount: this.exactMappings.get(contestUrl)?.successCount,
      },
      'Successful mapping recorded',
    );
  }

  /**
   * Retrieves a previously learned mapping for an exact contest URL.
   * Returns null if no mapping exists.
   */
  getMapping(contestUrl: string): Record<string, string> | null {
    const record = this.exactMappings.get(contestUrl);
    if (!record) {
      return null;
    }

    log.debug(
      {
        contestUrl,
        successCount: record.successCount,
        fieldCount: Object.keys(record.formMapping).length,
      },
      'Exact mapping found',
    );

    return { ...record.formMapping };
  }

  /**
   * Finds a mapping from a similar domain when no exact URL match exists.
   *
   * Selects the mapping with the highest success count from the same domain.
   * Returns null if no domain mappings exist.
   */
  getSimilarMapping(contestUrl: string): Record<string, string> | null {
    const domain = extractDomain(contestUrl);
    const domainRecords = this.domainMappings.get(domain);

    if (!domainRecords || domainRecords.length === 0) {
      log.debug({ contestUrl, domain }, 'No similar domain mappings found');
      return null;
    }

    // Find the mapping with the highest success count
    let best: MappingRecord | null = null;
    for (const record of domainRecords) {
      if (!best || record.successCount > best.successCount) {
        best = record;
      }
    }

    if (!best) {
      return null;
    }

    log.info(
      {
        contestUrl,
        domain,
        matchedUrl: best.contestUrl,
        successCount: best.successCount,
        fieldCount: Object.keys(best.formMapping).length,
      },
      'Similar domain mapping found',
    );

    return { ...best.formMapping };
  }

  /**
   * Loads previously persisted mappings from the database.
   * Queries actual successful entry counts per contest to set accurate
   * success counts rather than defaulting to 1.
   * Call this during initialization to restore learned patterns.
   */
  async loadFromDatabase(): Promise<void> {
    const db = getDb();

    const contests = db
      .select({
        id: schema.contests.id,
        url: schema.contests.url,
        formMapping: schema.contests.formMapping,
      })
      .from(schema.contests)
      .where(sql`${schema.contests.formMapping} != '{}' AND ${schema.contests.formMapping} IS NOT NULL`)
      .all();

    // Build a map of contestId -> successful entry count from the entries table.
    // This gives us real success counts rather than the default of 1.
    const { entries } = schema;
    const successCounts = db
      .select({
        contestId: entries.contestId,
        cnt: sql<number>`count(*)`,
      })
      .from(entries)
      .where(
        sql`${entries.status} in ('submitted', 'confirmed', 'won')`,
      )
      .groupBy(entries.contestId)
      .all();

    const successMap = new Map<string, number>();
    for (const row of successCounts) {
      successMap.set(row.contestId, row.cnt);
    }

    let loadedCount = 0;

    for (const contest of contests) {
      if (!contest.formMapping || contest.formMapping === '{}') continue;

      try {
        const mapping = JSON.parse(contest.formMapping) as Record<string, string>;
        if (Object.keys(mapping).length > 0) {
          const domain = extractDomain(contest.url);
          // Use actual successful entry count if available, else default to 1
          const realSuccessCount = successMap.get(contest.id) ?? 1;
          const record: MappingRecord = {
            contestUrl: contest.url,
            domain,
            formMapping: mapping,
            successCount: realSuccessCount,
            lastUsedAt: Date.now(),
          };

          this.exactMappings.set(contest.url, record);

          const domainRecords = this.domainMappings.get(domain) ?? [];
          domainRecords.push(record);
          this.domainMappings.set(domain, domainRecords);

          loadedCount += 1;
        }
      } catch {
        log.debug(
          { contestId: contest.id },
          'Failed to parse form mapping from database',
        );
      }
    }

    log.info(
      {
        loadedMappings: loadedCount,
        totalDomains: this.domainMappings.size,
      },
      'Pattern learner initialized from database with real success counts',
    );
  }

  /**
   * Returns statistics about learned patterns.
   */
  getStats(): {
    totalMappings: number;
    totalDomains: number;
    topDomains: Array<{ domain: string; count: number }>;
  } {
    const topDomains: Array<{ domain: string; count: number }> = [];

    for (const [domain, records] of this.domainMappings) {
      topDomains.push({ domain, count: records.length });
    }

    topDomains.sort((a, b) => b.count - a.count);

    return {
      totalMappings: this.exactMappings.size,
      totalDomains: this.domainMappings.size,
      topDomains: topDomains.slice(0, 10),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Persists a mapping to the contest's form_mapping column in the database.
   */
  private async persistMapping(
    contestUrl: string,
    formMapping: Record<string, string>,
  ): Promise<void> {
    const db = getDb();

    await db
      .update(schema.contests)
      .set({
        formMapping: JSON.stringify(formMapping),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.contests.url, contestUrl));
  }
}
