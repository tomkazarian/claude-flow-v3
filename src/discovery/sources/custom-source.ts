/**
 * Custom source handler for user-defined sweepstakes pages.
 *
 * Accepts user-configured CSS selectors and can scrape any list-style
 * sweepstakes page that follows a card/row pattern.
 */

import * as cheerio from 'cheerio';
import got from 'got';
import { getLogger } from '../../shared/logger.js';
import { DiscoveryError } from '../../shared/errors.js';
import { eventBus } from '../../shared/events.js';
import { retry } from '../../shared/retry.js';
import { sleep } from '../../shared/timing.js';
import { USER_AGENTS } from '../../shared/constants.js';
import { pickRandom, normalizeUrl } from '../../shared/utils.js';
import type { DiscoverySource, RawContest, CrawlResult, CrawlError } from '../types.js';
import type { SourceHandler } from './index.js';

const log = getLogger('discovery', { component: 'custom-source' });

const DEFAULT_RATE_LIMIT_MS = 2000;
const DEFAULT_MAX_PAGES = 5;
const REQUEST_TIMEOUT_MS = 30_000;

export class CustomSourceHandler implements SourceHandler {
  readonly name = 'custom';

  /**
   * Crawl a user-defined source using their configured selectors.
   */
  async crawl(source: DiscoverySource): Promise<CrawlResult> {
    const startTime = Date.now();
    const contests: RawContest[] = [];
    const errors: CrawlError[] = [];
    let pagesCrawled = 0;
    const maxPages = source.maxPages ?? DEFAULT_MAX_PAGES;
    const rateLimitMs = source.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;

    if (!source.selectors) {
      throw new DiscoveryError(
        'Custom source requires selectors configuration',
        'MISSING_SELECTORS',
        source.id,
      );
    }

    if (!source.selectors.contestCard || !source.selectors.contestLink) {
      throw new DiscoveryError(
        'Custom source requires at minimum contestCard and contestLink selectors',
        'INVALID_SELECTORS',
        source.id,
      );
    }

    log.info(
      { sourceId: source.id, url: source.url },
      'Starting custom source crawl',
    );
    eventBus.emit('discovery:started', { source: source.id });

    let currentUrl: string | null = source.url;

    while (currentUrl && pagesCrawled < maxPages) {
      try {
        if (pagesCrawled > 0) {
          await sleep(rateLimitMs);
        }

        const html = await this.fetchPage(currentUrl, source.id);
        pagesCrawled++;

        const pageContests = this.extractContests(html, currentUrl, source);
        contests.push(...pageContests);

        log.info(
          { url: currentUrl, found: pageContests.length, total: contests.length },
          'Custom source page crawled',
        );

        currentUrl = this.findNextPage(html, currentUrl, source);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ url: currentUrl, error: message }, 'Error crawling custom source page');
        errors.push({
          url: currentUrl!,
          message,
          code: error instanceof DiscoveryError ? error.code : 'CRAWL_ERROR',
        });
        break;
      }
    }

    const durationMs = Date.now() - startTime;

    eventBus.emit('discovery:completed', {
      source: source.id,
      contestsFound: contests.length,
    });

    log.info(
      { sourceId: source.id, totalContests: contests.length, pagesCrawled, durationMs },
      'Custom source crawl completed',
    );

    return { source, contests, pagesCrawled, durationMs, errors };
  }

  /**
   * Fetch a page with retry logic.
   */
  private async fetchPage(url: string, sourceId: string): Promise<string> {
    const userAgent = pickRandom(USER_AGENTS);

    const response = await retry(
      () =>
        got.get(url, {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          responseType: 'text',
          timeout: { request: REQUEST_TIMEOUT_MS },
          followRedirect: true,
        }),
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'],
      },
    );

    if (response.statusCode < 200 || response.statusCode >= 400) {
      throw new DiscoveryError(
        `HTTP ${response.statusCode} from custom source ${url}`,
        'HTTP_ERROR',
        sourceId,
      );
    }

    return response.body;
  }

  /**
   * Extract contests using user-configured selectors.
   */
  private extractContests(
    html: string,
    pageUrl: string,
    source: DiscoverySource,
  ): RawContest[] {
    const selectors = source.selectors!;
    const $ = cheerio.load(html);
    const contests: RawContest[] = [];

    $(selectors.contestCard).each((_index, element) => {
      try {
        const card = $(element);

        const linkEl = card.find(selectors.contestLink).first();
        let url = linkEl.attr('href') ?? '';
        if (!url) return;

        if (!url.startsWith('http')) {
          url = new URL(url, pageUrl).toString();
        }
        url = normalizeUrl(url);

        // Title: from dedicated selector or fall back to link text
        let title = '';
        if (selectors.contestTitle) {
          title = card.find(selectors.contestTitle).first().text().trim();
        }
        if (!title) {
          title = linkEl.text().trim();
        }
        if (!title) return;

        // Optional fields
        const endDate = selectors.endDate
          ? card.find(selectors.endDate).first().text().trim()
          : '';
        const prizeDescription = selectors.prize
          ? card.find(selectors.prize).first().text().trim()
          : '';
        const sponsor = selectors.sponsor
          ? card.find(selectors.sponsor).first().text().trim()
          : '';
        const entryMethod = selectors.entryMethod
          ? card.find(selectors.entryMethod).first().text().trim()
          : 'form';

        contests.push({
          url,
          title,
          sponsor,
          endDate,
          prizeDescription,
          source: source.id,
          entryMethod,
          type: this.inferType(title, prizeDescription),
        });
      } catch (error) {
        log.debug(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to extract contest from custom source card',
        );
      }
    });

    return contests;
  }

  /**
   * Find the next page using pagination config or selector.
   */
  private findNextPage(
    html: string,
    currentUrl: string,
    source: DiscoverySource,
  ): string | null {
    const $ = cheerio.load(html);

    // Use pagination config if available
    if (source.pagination) {
      const { type, nextSelector, paramName, pageSize } = source.pagination;

      if (type === 'link' && nextSelector) {
        const nextHref = $(nextSelector).attr('href');
        if (nextHref) {
          return nextHref.startsWith('http')
            ? normalizeUrl(nextHref)
            : normalizeUrl(new URL(nextHref, currentUrl).toString());
        }
      }

      if (type === 'page-number' && paramName) {
        const parsed = new URL(currentUrl);
        const currentPage = parseInt(parsed.searchParams.get(paramName) ?? '1', 10);
        parsed.searchParams.set(paramName, String(currentPage + 1));
        return parsed.toString();
      }

      if (type === 'offset' && paramName && pageSize) {
        const parsed = new URL(currentUrl);
        const currentOffset = parseInt(parsed.searchParams.get(paramName) ?? '0', 10);
        parsed.searchParams.set(paramName, String(currentOffset + pageSize));
        return parsed.toString();
      }
    }

    // Fall back to nextPage selector from source selectors
    if (source.selectors?.nextPage) {
      const nextHref = $(source.selectors.nextPage).attr('href');
      if (nextHref) {
        return nextHref.startsWith('http')
          ? normalizeUrl(nextHref)
          : normalizeUrl(new URL(nextHref, currentUrl).toString());
      }
    }

    return null;
  }

  /**
   * Infer contest type from keywords.
   */
  private inferType(title: string, prize: string): string {
    const combined = `${title} ${prize}`.toLowerCase();

    if (combined.includes('instant win') || combined.includes('instant-win')) {
      return 'instant_win';
    }
    if (combined.includes('daily')) {
      return 'daily_entry';
    }
    if (combined.includes('giveaway')) {
      return 'giveaway';
    }

    return 'sweepstakes';
  }
}
