/**
 * Web crawler for sweepstakes aggregator sites.
 *
 * Fetches pages from configured discovery sources, extracts contest
 * links and details using CSS selectors, supports pagination, rate
 * limiting per domain, and basic robots.txt checking.
 */

import * as cheerio from 'cheerio';
import got, { type Got, type Response } from 'got';
import { getLogger } from '../shared/logger.js';
import { DiscoveryError } from '../shared/errors.js';
import { eventBus } from '../shared/events.js';
import { retry } from '../shared/retry.js';
import { sleep } from '../shared/timing.js';
import { USER_AGENTS } from '../shared/constants.js';
import { pickRandom, extractDomain, normalizeUrl } from '../shared/utils.js';
import type {
  DiscoverySource,
  RawContest,
  CrawlResult,
  CrawlError,
} from './types.js';

const log = getLogger('discovery', { component: 'crawler' });

/** Per-domain timestamps of the last request, used for rate limiting. */
const domainLastRequest = new Map<string, number>();

/** Cache of robots.txt disallow rules per domain. */
const robotsCache = new Map<string, string[]>();

const DEFAULT_RATE_LIMIT_MS = 2000;
const DEFAULT_MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 30_000;

export class SweepstakesCrawler {
  private readonly client: Got;

  constructor() {
    this.client = got.extend({
      timeout: { request: REQUEST_TIMEOUT_MS },
      retry: { limit: 0 },
      followRedirect: true,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
      },
      https: { rejectUnauthorized: false },
    });
  }

  /**
   * Crawl a single discovery source, following pagination up to maxPages.
   * Returns all discovered raw contests along with crawl metadata.
   */
  async crawl(source: DiscoverySource): Promise<CrawlResult> {
    const startTime = Date.now();
    const contests: RawContest[] = [];
    const errors: CrawlError[] = [];
    let pagesCrawled = 0;
    const maxPages = source.maxPages ?? DEFAULT_MAX_PAGES;

    log.info({ sourceId: source.id, url: source.url }, 'Starting crawl for source');
    eventBus.emit('discovery:started', { source: source.id });

    let currentUrl: string | null = source.url;

    while (currentUrl && pagesCrawled < maxPages) {
      try {
        const allowed = await this.checkRobotsAllowed(currentUrl);
        if (!allowed) {
          log.warn({ url: currentUrl }, 'Blocked by robots.txt, skipping');
          errors.push({
            url: currentUrl,
            message: 'Blocked by robots.txt',
            code: 'ROBOTS_BLOCKED',
          });
          break;
        }

        await this.enforceRateLimit(currentUrl, source.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS);

        const html = await this.fetchPage(currentUrl, source.id);
        pagesCrawled++;

        const pageContests = this.extractContests(html, currentUrl, source);
        contests.push(...pageContests);

        log.info(
          { url: currentUrl, found: pageContests.length, total: contests.length },
          'Page crawled successfully',
        );

        currentUrl = this.findNextPage(html, currentUrl, source);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ url: currentUrl, error: message }, 'Error crawling page');
        errors.push({
          url: currentUrl!,
          message,
          code: error instanceof DiscoveryError ? error.code : 'CRAWL_ERROR',
        });
        break;
      }
    }

    const durationMs = Date.now() - startTime;

    log.info(
      {
        sourceId: source.id,
        totalContests: contests.length,
        pagesCrawled,
        durationMs,
        errorCount: errors.length,
      },
      'Crawl completed',
    );

    eventBus.emit('discovery:completed', {
      source: source.id,
      contestsFound: contests.length,
    });

    return { source, contests, pagesCrawled, durationMs, errors };
  }

  /**
   * Fetch a single HTML page with retry logic.
   */
  private async fetchPage(url: string, sourceId: string): Promise<string> {
    const userAgent = pickRandom(USER_AGENTS);

    const response = await retry<Response<string>>(
      () =>
        this.client.get(url, {
          headers: { 'User-Agent': userAgent },
          responseType: 'text',
        }),
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ERR_NON_2XX_STATUS_CODE'],
      },
    );

    if (response.statusCode < 200 || response.statusCode >= 400) {
      throw new DiscoveryError(
        `HTTP ${response.statusCode} fetching ${url}`,
        'HTTP_ERROR',
        sourceId,
      );
    }

    return response.body;
  }

  /**
   * Extract contest entries from the fetched HTML using the source's CSS selectors.
   */
  private extractContests(
    html: string,
    pageUrl: string,
    source: DiscoverySource,
  ): RawContest[] {
    const selectors = source.selectors;
    if (!selectors) {
      log.warn({ sourceId: source.id }, 'No selectors configured, returning empty');
      return [];
    }

    const $ = cheerio.load(html);
    const contests: RawContest[] = [];

    $(selectors.contestCard).each((_index, element) => {
      try {
        const card = $(element);

        const linkEl = card.find(selectors.contestLink);
        let url = linkEl.attr('href') ?? '';
        if (url && !url.startsWith('http')) {
          url = new URL(url, pageUrl).toString();
        }
        url = normalizeUrl(url);

        const title = (card.find(selectors.contestTitle).text() ?? '').trim();
        const endDate = selectors.endDate
          ? (card.find(selectors.endDate).text() ?? '').trim()
          : '';
        const prizeDescription = selectors.prize
          ? (card.find(selectors.prize).text() ?? '').trim()
          : '';
        const sponsor = selectors.sponsor
          ? (card.find(selectors.sponsor).text() ?? '').trim()
          : '';
        const entryMethod = selectors.entryMethod
          ? (card.find(selectors.entryMethod).text() ?? '').trim()
          : '';

        if (!url || !title) {
          return;
        }

        contests.push({
          url,
          title,
          sponsor,
          endDate,
          prizeDescription,
          source: source.id,
          entryMethod,
          type: this.inferContestType(title, prizeDescription),
        });
      } catch (error) {
        log.debug(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to extract contest from card',
        );
      }
    });

    return contests;
  }

  /**
   * Find the next page URL from pagination links.
   */
  private findNextPage(
    html: string,
    currentUrl: string,
    source: DiscoverySource,
  ): string | null {
    const $ = cheerio.load(html);
    const pagination = source.pagination;
    const selectors = source.selectors;

    // Try pagination config first
    if (pagination) {
      if (pagination.type === 'link' && pagination.nextSelector) {
        const nextHref = $(pagination.nextSelector).attr('href');
        if (nextHref) {
          return nextHref.startsWith('http')
            ? normalizeUrl(nextHref)
            : normalizeUrl(new URL(nextHref, currentUrl).toString());
        }
      }

      if (pagination.type === 'page-number' && pagination.paramName) {
        const parsed = new URL(currentUrl);
        const currentPage = parseInt(parsed.searchParams.get(pagination.paramName) ?? '1', 10);
        parsed.searchParams.set(pagination.paramName, String(currentPage + 1));
        return parsed.toString();
      }

      if (pagination.type === 'offset' && pagination.paramName && pagination.pageSize) {
        const parsed = new URL(currentUrl);
        const currentOffset = parseInt(
          parsed.searchParams.get(pagination.paramName) ?? '0',
          10,
        );
        parsed.searchParams.set(
          pagination.paramName,
          String(currentOffset + pagination.pageSize),
        );
        return parsed.toString();
      }
    }

    // Fall back to the next page selector from source selectors
    if (selectors?.nextPage) {
      const nextHref = $(selectors.nextPage).attr('href');
      if (nextHref) {
        return nextHref.startsWith('http')
          ? normalizeUrl(nextHref)
          : normalizeUrl(new URL(nextHref, currentUrl).toString());
      }
    }

    // Try common next-page patterns
    const commonNextSelectors = [
      'a.next', 'a.next-page', '.pagination a.next',
      '.pagination .next a', 'a[rel="next"]',
      '.pager .next a', 'li.next a',
    ];

    for (const sel of commonNextSelectors) {
      const nextHref = $(sel).attr('href');
      if (nextHref) {
        return nextHref.startsWith('http')
          ? normalizeUrl(nextHref)
          : normalizeUrl(new URL(nextHref, currentUrl).toString());
      }
    }

    return null;
  }

  /**
   * Enforce per-domain rate limiting. Waits if the last request
   * to the same domain was too recent.
   */
  private async enforceRateLimit(url: string, minDelayMs: number): Promise<void> {
    const domain = extractDomain(url);
    const lastRequest = domainLastRequest.get(domain);

    if (lastRequest !== undefined) {
      const elapsed = Date.now() - lastRequest;
      if (elapsed < minDelayMs) {
        const waitTime = minDelayMs - elapsed;
        log.debug({ domain, waitTime }, 'Rate limiting: waiting before next request');
        await sleep(waitTime);
      }
    }

    domainLastRequest.set(domain, Date.now());
  }

  /**
   * Check robots.txt for the given URL. Returns true if crawling is allowed.
   * Uses a basic check: fetches robots.txt once per domain and checks Disallow rules.
   */
  private async checkRobotsAllowed(url: string): Promise<boolean> {
    const domain = extractDomain(url);

    if (!robotsCache.has(domain)) {
      try {
        const robotsUrl = new URL('/robots.txt', url).toString();
        const response = await this.client.get(robotsUrl, {
          headers: { 'User-Agent': pickRandom(USER_AGENTS) },
          responseType: 'text',
          timeout: { request: 10_000 },
        });

        const disallowRules = this.parseRobotsTxt(response.body);
        robotsCache.set(domain, disallowRules);
      } catch {
        // If we cannot fetch robots.txt, assume crawling is allowed.
        robotsCache.set(domain, []);
      }
    }

    const disallowedPaths = robotsCache.get(domain) ?? [];
    const parsed = new URL(url);
    const path = parsed.pathname;

    for (const rule of disallowedPaths) {
      if (rule === '/') {
        return false;
      }
      if (path.startsWith(rule)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parse robots.txt content and extract Disallow rules for all user agents (*).
   */
  private parseRobotsTxt(content: string): string[] {
    const lines = content.split('\n');
    const disallowRules: string[] = [];
    let isWildcardAgent = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (line.toLowerCase().startsWith('user-agent:')) {
        const agent = line.slice('user-agent:'.length).trim();
        isWildcardAgent = agent === '*';
        continue;
      }

      if (isWildcardAgent && line.toLowerCase().startsWith('disallow:')) {
        const path = line.slice('disallow:'.length).trim();
        if (path) {
          disallowRules.push(path);
        }
      }
    }

    return disallowRules;
  }

  /**
   * Infer the contest type from title and prize text keywords.
   */
  private inferContestType(title: string, prize: string): string {
    const combined = `${title} ${prize}`.toLowerCase();

    if (combined.includes('instant win') || combined.includes('instant-win')) {
      return 'instant_win';
    }
    if (combined.includes('daily') || combined.includes('enter daily')) {
      return 'daily_entry';
    }
    if (combined.includes('giveaway')) {
      return 'giveaway';
    }
    if (combined.includes('raffle')) {
      return 'sweepstakes';
    }
    if (combined.includes('sweepstakes') || combined.includes('sweeps')) {
      return 'sweepstakes';
    }
    if (combined.includes('contest')) {
      return 'sweepstakes';
    }

    return 'sweepstakes';
  }
}
