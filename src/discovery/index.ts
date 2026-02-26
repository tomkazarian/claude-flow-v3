/**
 * Discovery module public API.
 *
 * Re-exports all types and classes needed by consumers of the
 * sweepstakes discovery pipeline: crawling, RSS fetching,
 * extraction, deduplication, legitimacy scoring, and source handling.
 */

// Types
export type {
  DiscoverySource,
  SourceSelectors,
  PaginationConfig,
  RawContest,
  ContestDetails,
  LegitimacyReport,
  LegitimacyFactor,
  DeduplicationResult,
  CrawlResult,
  CrawlError,
} from './types.js';

// Core classes
export { SweepstakesCrawler } from './crawler.js';
export { RSSFetcher } from './rss-fetcher.js';
export { extractContestDetails } from './contest-extractor.js';
export { ContestDeduplicator } from './deduplicator.js';
export { LegitimacyScorer } from './legitimacy-scorer.js';

// Source handlers
export {
  createSourceHandler,
  getAvailableHandlers,
  SweepstakesAdvantageSource,
  OnlineSweepstakesSource,
  CustomSourceHandler,
} from './sources/index.js';
export type { SourceHandler } from './sources/index.js';
