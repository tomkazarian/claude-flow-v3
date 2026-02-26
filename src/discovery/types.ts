/**
 * Type definitions for the discovery module.
 * These types define the shape of data flowing through the crawling,
 * extraction, deduplication, and scoring pipeline.
 */

import type { ContestType, EntryMethod } from '../shared/constants.js';

// ---------------------------------------------------------------------------
// Discovery source configuration
// ---------------------------------------------------------------------------

export interface DiscoverySource {
  /** Unique identifier for this source configuration. */
  id: string;
  /** Human-readable name (e.g. "Sweepstakes Advantage"). */
  name: string;
  /** Base URL to begin crawling. */
  url: string;
  /** Source type determines which handler processes the source. */
  type: 'html' | 'rss' | 'custom';
  /** Whether this source is currently enabled. */
  enabled: boolean;
  /** CSS selector configuration for HTML sources. */
  selectors?: SourceSelectors;
  /** Pagination configuration. */
  pagination?: PaginationConfig;
  /** Category filters to apply when crawling. */
  categories?: string[];
  /** Maximum pages to crawl in one session. */
  maxPages?: number;
  /** Minimum delay between requests to this source in ms. */
  rateLimitMs?: number;
}

export interface SourceSelectors {
  /** Selector for the container holding each contest card/row. */
  contestCard: string;
  /** Selector within a card for the contest link. */
  contestLink: string;
  /** Selector within a card for the contest title. */
  contestTitle: string;
  /** Selector within a card for the end date. */
  endDate?: string;
  /** Selector within a card for the prize description. */
  prize?: string;
  /** Selector within a card for the sponsor name. */
  sponsor?: string;
  /** Selector within a card for the entry method. */
  entryMethod?: string;
  /** Selector for the "next page" link. */
  nextPage?: string;
}

export interface PaginationConfig {
  /** Strategy for discovering the next page. */
  type: 'link' | 'offset' | 'page-number';
  /** Selector for the next page link (used with type 'link'). */
  nextSelector?: string;
  /** URL parameter name for offset-based pagination. */
  paramName?: string;
  /** Page size for offset-based pagination. */
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Raw contest data (before enrichment)
// ---------------------------------------------------------------------------

export interface RawContest {
  /** The direct URL of the contest page. */
  url: string;
  /** Contest title as discovered. */
  title: string;
  /** Sponsor or brand name, if detected. */
  sponsor: string;
  /** End date as a raw string from the source. */
  endDate: string;
  /** Prize description text. */
  prizeDescription: string;
  /** Which discovery source found this contest. */
  source: string;
  /** Detected entry method keyword. */
  entryMethod: string;
  /** Contest type keyword (sweepstakes, giveaway, etc.). */
  type: string;
}

// ---------------------------------------------------------------------------
// Enriched contest details (from page analysis)
// ---------------------------------------------------------------------------

export interface ContestDetails {
  /** Categorized contest type. */
  type: ContestType | string;
  /** Parsed end date, or null if not found. */
  endDate: Date | null;
  /** Prize description text. */
  prizeDescription: string;
  /** Estimated prize monetary value, or null if unknown. */
  prizeValue: number | null;
  /** Detected entry method. */
  entryMethod: EntryMethod | string;
  /** How often one can enter (daily, once, weekly, etc.). */
  entryFrequency: string;
  /** Minimum age requirement, or null. */
  ageRequirement: number | null;
  /** Geographic restrictions (country/state list). */
  geoRestrictions: string[];
  /** URL to official rules/terms, or null. */
  termsUrl: string | null;
  /** Whether a CAPTCHA was detected on the page. */
  hasCaptcha: boolean;
  /** Whether email confirmation is required. */
  requiresEmailConfirm: boolean;
}

// ---------------------------------------------------------------------------
// Legitimacy scoring
// ---------------------------------------------------------------------------

export interface LegitimacyReport {
  /** Overall score 0-1 (1 = most legitimate). */
  score: number;
  /** Individual factor breakdowns. */
  factors: LegitimacyFactor[];
  /** Whether the contest passed minimum threshold. */
  passed: boolean;
  /** Human-readable summary. */
  summary: string;
}

export interface LegitimacyFactor {
  name: string;
  score: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

export interface DeduplicationResult {
  /** Whether this contest is a duplicate. */
  isDuplicate: boolean;
  /** If duplicate, the ID of the existing contest. */
  existingId?: string;
  /** Method used to detect the duplicate. */
  method?: 'exact-url' | 'normalized-url' | 'title-similarity' | 'content-hash';
}

// ---------------------------------------------------------------------------
// Crawler state
// ---------------------------------------------------------------------------

export interface CrawlResult {
  /** Source that was crawled. */
  source: DiscoverySource;
  /** Contests discovered. */
  contests: RawContest[];
  /** Number of pages crawled. */
  pagesCrawled: number;
  /** Total duration in milliseconds. */
  durationMs: number;
  /** Errors encountered during crawling. */
  errors: CrawlError[];
}

export interface CrawlError {
  url: string;
  message: string;
  code: string;
}
