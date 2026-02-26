/**
 * Source registry - factory pattern for creating source handlers.
 *
 * Maps source type identifiers to the appropriate handler class.
 * All source handlers implement the same interface: given a
 * DiscoverySource configuration, they return RawContest records.
 */

import { getLogger } from '../../shared/logger.js';
import { DiscoveryError } from '../../shared/errors.js';
import type { DiscoverySource, CrawlResult } from '../types.js';
import { SweepstakesCrawler } from '../crawler.js';
import { RSSFetcher } from '../rss-fetcher.js';
import { SweepstakesAdvantageSource } from './sweepstakes-advantage.js';
import { OnlineSweepstakesSource } from './online-sweepstakes.js';
import { CustomSourceHandler } from './custom-source.js';

const log = getLogger('discovery', { component: 'source-registry' });

/**
 * Interface all source handlers must implement.
 */
export interface SourceHandler {
  readonly name: string;
  crawl(source: DiscoverySource): Promise<CrawlResult>;
}

/** Map of source IDs to specialized handler classes. */
const SPECIALIZED_HANDLERS: Record<string, new () => SourceHandler> = {
  'sweepstakes-advantage': SweepstakesAdvantageSource,
  'online-sweepstakes': OnlineSweepstakesSource,
};

/**
 * Create the appropriate source handler for a given discovery source.
 *
 * - Known source IDs (e.g. "sweepstakes-advantage") get a specialized handler.
 * - Sources with type "rss" get an RSS handler wrapper.
 * - Sources with type "custom" get the CustomSourceHandler.
 * - Everything else uses the generic SweepstakesCrawler.
 */
export function createSourceHandler(source: DiscoverySource): SourceHandler {
  // Check for specialized handlers first
  const SpecializedClass = SPECIALIZED_HANDLERS[source.id];
  if (SpecializedClass) {
    log.debug({ sourceId: source.id }, 'Using specialized handler');
    return new SpecializedClass();
  }

  // RSS/Atom feed
  if (source.type === 'rss') {
    log.debug({ sourceId: source.id }, 'Using RSS handler');
    return new RSSSourceHandler();
  }

  // Custom user-defined source
  if (source.type === 'custom') {
    log.debug({ sourceId: source.id }, 'Using custom handler');
    return new CustomSourceHandler();
  }

  // Default: generic HTML crawler
  log.debug({ sourceId: source.id }, 'Using generic HTML crawler');
  return new GenericHTMLHandler();
}

/**
 * Get all available source handler IDs.
 */
export function getAvailableHandlers(): string[] {
  return [...Object.keys(SPECIALIZED_HANDLERS), 'rss', 'custom', 'html'];
}

// ---------------------------------------------------------------------------
// Handler wrappers
// ---------------------------------------------------------------------------

/**
 * Wraps the RSSFetcher into the SourceHandler interface.
 */
class RSSSourceHandler implements SourceHandler {
  readonly name = 'rss';
  private readonly fetcher = new RSSFetcher();

  async crawl(source: DiscoverySource): Promise<CrawlResult> {
    const startTime = Date.now();

    try {
      const contests = await this.fetcher.fetch(source.url);
      return {
        source,
        contests,
        pagesCrawled: 1,
        durationMs: Date.now() - startTime,
        errors: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DiscoveryError(
        `RSS fetch failed for ${source.url}: ${message}`,
        'RSS_FETCH_FAILED',
        source.id,
      );
    }
  }
}

/**
 * Wraps the generic SweepstakesCrawler into the SourceHandler interface.
 */
class GenericHTMLHandler implements SourceHandler {
  readonly name = 'html';
  private readonly crawler = new SweepstakesCrawler();

  async crawl(source: DiscoverySource): Promise<CrawlResult> {
    return this.crawler.crawl(source);
  }
}

export { SweepstakesAdvantageSource } from './sweepstakes-advantage.js';
export { OnlineSweepstakesSource } from './online-sweepstakes.js';
export { CustomSourceHandler } from './custom-source.js';
