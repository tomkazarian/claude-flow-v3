/**
 * Online-Sweepstakes.com specialized crawler.
 *
 * Handles the specific HTML structure, CSS selectors, and pagination
 * for the Online-Sweepstakes.com website.
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

const log = getLogger('discovery', { component: 'online-sweepstakes' });

const BASE_URL = 'https://www.online-sweepstakes.com';
const RATE_LIMIT_MS = 2500;
const REQUEST_TIMEOUT_MS = 30_000;

/** Category URL paths. */
const CATEGORY_PATHS: Record<string, string> = {
  'new': '/new.html',
  'expiring': '/expiring.html',
  'daily': '/daily.html',
  'one-entry': '/oneentry.html',
  'all': '/sweepstakes.html',
};

/**
 * CSS selectors tailored to Online-Sweepstakes.com page structure.
 */
const SELECTORS = {
  contestCard: '.sweeps-listing .sweeps-item, table.sweeps-list tr, .listing-row, .contest-row, .sweeps-entry',
  contestLink: 'a.sweeps-link, td a[href], a[href*="sweepstakes"], .title a, h3 a, h2 a',
  contestTitle: '.sweeps-name, .contest-name, .title, h3, h2, td:first-child a, td:nth-child(2)',
  endDate: '.exp-date, .end-date, .expires, td.date, td:nth-child(3), .deadline',
  prize: '.prize, .prize-info, td.prize, td:nth-child(4), .prize-desc',
  sponsor: '.sponsor, .company, td.sponsor, td:nth-child(5)',
  nextPage: 'a.next, .pagination a.next, a[rel="next"], .pager .next a',
};

export class OnlineSweepstakesSource implements SourceHandler {
  readonly name = 'online-sweepstakes';

  /**
   * Crawl Online-Sweepstakes.com for contest listings.
   */
  async crawl(source: DiscoverySource): Promise<CrawlResult> {
    const startTime = Date.now();
    const contests: RawContest[] = [];
    const errors: CrawlError[] = [];
    let pagesCrawled = 0;
    const maxPages = source.maxPages ?? 5;

    log.info({ sourceId: source.id }, 'Starting Online-Sweepstakes.com crawl');
    eventBus.emit('discovery:started', { source: this.name });

    const categories = source.categories ?? ['all'];
    const categoryUrls = categories
      .map((cat) => CATEGORY_PATHS[cat])
      .filter(Boolean)
      .map((path) => `${BASE_URL}${path}`);

    if (categoryUrls.length === 0) {
      categoryUrls.push(`${BASE_URL}${CATEGORY_PATHS['all']}`);
    }

    for (const categoryUrl of categoryUrls) {
      let currentUrl: string | null = categoryUrl;

      while (currentUrl && pagesCrawled < maxPages) {
        try {
          await sleep(RATE_LIMIT_MS);

          const html = await this.fetchPage(currentUrl);
          pagesCrawled++;

          const pageContests = this.extractContests(html, currentUrl);
          contests.push(...pageContests);

          log.info(
            { url: currentUrl, found: pageContests.length, total: contests.length },
            'Page crawled',
          );

          currentUrl = this.findNextPage(html, currentUrl);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error({ url: currentUrl, error: message }, 'Error crawling page');
          errors.push({
            url: currentUrl!,
            message,
            code: 'CRAWL_ERROR',
          });
          currentUrl = null;
        }
      }
    }

    const durationMs = Date.now() - startTime;

    eventBus.emit('discovery:completed', {
      source: this.name,
      contestsFound: contests.length,
    });

    log.info(
      { totalContests: contests.length, pagesCrawled, durationMs },
      'Online-Sweepstakes.com crawl completed',
    );

    return { source, contests, pagesCrawled, durationMs, errors };
  }

  /**
   * Fetch a page with retry logic.
   */
  private async fetchPage(url: string): Promise<string> {
    const userAgent = pickRandom(USER_AGENTS);

    const response = await retry(
      () =>
        got.get(url, {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': BASE_URL,
          },
          responseType: 'text',
          timeout: { request: REQUEST_TIMEOUT_MS },
          followRedirect: true,
        }),
      {
        maxAttempts: 3,
        baseDelayMs: 3000,
        retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'],
      },
    );

    if (response.statusCode < 200 || response.statusCode >= 400) {
      throw new DiscoveryError(
        `HTTP ${response.statusCode} from Online-Sweepstakes.com`,
        'HTTP_ERROR',
        this.name,
      );
    }

    return response.body;
  }

  /**
   * Extract contests from an Online-Sweepstakes.com listing page.
   */
  private extractContests(html: string, pageUrl: string): RawContest[] {
    const $ = cheerio.load(html);
    const contests: RawContest[] = [];

    $(SELECTORS.contestCard).each((_index, element) => {
      try {
        const card = $(element);

        const linkEl = card.find(SELECTORS.contestLink).first();
        let url = linkEl.attr('href') ?? '';
        if (!url) return;

        if (!url.startsWith('http')) {
          url = new URL(url, pageUrl).toString();
        }
        url = normalizeUrl(url);

        const title = (
          card.find(SELECTORS.contestTitle).first().text() ??
          linkEl.text() ??
          ''
        ).trim();
        if (!title) return;

        const endDate = (card.find(SELECTORS.endDate).first().text() ?? '').trim();
        const prizeDescription = (card.find(SELECTORS.prize).first().text() ?? '').trim();
        const sponsor = (card.find(SELECTORS.sponsor).first().text() ?? '').trim();

        const type = this.inferType(title, prizeDescription, pageUrl);

        contests.push({
          url,
          title,
          sponsor,
          endDate,
          prizeDescription,
          source: this.name,
          entryMethod: 'form',
          type,
        });
      } catch (error) {
        log.debug(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to extract contest card',
        );
      }
    });

    return contests;
  }

  /**
   * Find the next page link.
   */
  private findNextPage(html: string, currentUrl: string): string | null {
    const $ = cheerio.load(html);

    const nextHref = $(SELECTORS.nextPage).attr('href');
    if (nextHref) {
      if (nextHref.startsWith('http')) {
        return normalizeUrl(nextHref);
      }
      return normalizeUrl(new URL(nextHref, currentUrl).toString());
    }

    return null;
  }

  /**
   * Infer contest type from text and URL.
   */
  private inferType(title: string, prize: string, pageUrl: string): string {
    const combined = `${title} ${prize} ${pageUrl}`.toLowerCase();

    if (combined.includes('instant win') || combined.includes('instant-win')) {
      return 'instant_win';
    }
    if (combined.includes('daily')) {
      return 'daily_entry';
    }
    if (combined.includes('one-entry') || combined.includes('oneentry') || combined.includes('one entry')) {
      return 'sweepstakes';
    }
    if (combined.includes('giveaway')) {
      return 'giveaway';
    }

    return 'sweepstakes';
  }
}
