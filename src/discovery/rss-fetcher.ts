/**
 * RSS and Atom feed fetcher for sweepstakes discovery.
 *
 * Parses RSS 2.0 and Atom feeds to discover contest entries.
 * Extracts title, link, description, and publication date from
 * feed items and converts them into RawContest records.
 */

import * as cheerio from 'cheerio';
import got from 'got';
import { getLogger } from '../shared/logger.js';
import { DiscoveryError } from '../shared/errors.js';
import { retry } from '../shared/retry.js';
import { USER_AGENTS } from '../shared/constants.js';
import { pickRandom, normalizeUrl } from '../shared/utils.js';
import type { RawContest } from './types.js';

const log = getLogger('discovery', { component: 'rss-fetcher' });

const REQUEST_TIMEOUT_MS = 30_000;

/** Date patterns used to extract end dates from description HTML. */
const END_DATE_PATTERNS: RegExp[] = [
  /ends?\s*[:.]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  /expires?\s*[:.]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  /deadline\s*[:.]?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  /ends?\s*[:.]?\s*(\w+\s+\d{1,2},?\s+\d{4})/i,
  /expires?\s*[:.]?\s*(\w+\s+\d{1,2},?\s+\d{4})/i,
  /through\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  /until\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  /through\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
];

/** Keywords that indicate a sweepstakes-type entry. */
const CONTEST_KEYWORDS = [
  'sweepstakes', 'giveaway', 'contest', 'win', 'prize',
  'raffle', 'instant win', 'enter to win', 'free',
];

export class RSSFetcher {
  /**
   * Fetch and parse an RSS or Atom feed, returning discovered contests.
   */
  async fetch(feedUrl: string): Promise<RawContest[]> {
    log.info({ feedUrl }, 'Fetching RSS feed');

    const xml = await this.fetchFeed(feedUrl);
    const contests = this.parseFeed(xml, feedUrl);

    log.info({ feedUrl, found: contests.length }, 'RSS feed parsed');
    return contests;
  }

  /**
   * Download the feed XML content.
   */
  private async fetchFeed(feedUrl: string): Promise<string> {
    const userAgent = pickRandom(USER_AGENTS);

    const response = await retry(
      () =>
        got.get(feedUrl, {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
          },
          responseType: 'text',
          timeout: { request: REQUEST_TIMEOUT_MS },
        }),
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'],
      },
    );

    if (response.statusCode < 200 || response.statusCode >= 400) {
      throw new DiscoveryError(
        `HTTP ${response.statusCode} fetching feed ${feedUrl}`,
        'RSS_HTTP_ERROR',
        feedUrl,
      );
    }

    return response.body;
  }

  /**
   * Parse RSS 2.0 or Atom feed XML into RawContest records.
   * Auto-detects the feed format.
   */
  private parseFeed(xml: string, feedUrl: string): RawContest[] {
    const $ = cheerio.load(xml, { xml: true });

    // Detect feed format
    const isAtom = $('feed').length > 0;
    const isRss = $('rss').length > 0 || $('channel').length > 0;

    if (isAtom) {
      return this.parseAtomFeed($, feedUrl);
    }
    if (isRss) {
      return this.parseRssFeed($, feedUrl);
    }

    log.warn({ feedUrl }, 'Unrecognized feed format');
    return [];
  }

  /**
   * Parse RSS 2.0 format.
   */
  private parseRssFeed(
    $: cheerio.CheerioAPI,
    feedUrl: string,
  ): RawContest[] {
    const contests: RawContest[] = [];

    $('item').each((_index, element) => {
      try {
        const item = $(element);
        const title = item.find('title').text().trim();
        const link = item.find('link').text().trim();
        const description = item.find('description').text().trim();
        const pubDate = item.find('pubDate').text().trim();

        if (!title || !link) {
          return;
        }

        if (!this.isContestRelated(title, description)) {
          return;
        }

        const contest = this.buildRawContest(title, link, description, pubDate, feedUrl);
        contests.push(contest);
      } catch (error) {
        log.debug(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to parse RSS item',
        );
      }
    });

    return contests;
  }

  /**
   * Parse Atom feed format.
   */
  private parseAtomFeed(
    $: cheerio.CheerioAPI,
    feedUrl: string,
  ): RawContest[] {
    const contests: RawContest[] = [];

    $('entry').each((_index, element) => {
      try {
        const entry = $(element);
        const title = entry.find('title').text().trim();

        // Atom links use href attribute
        let link = entry.find('link[rel="alternate"]').attr('href') ?? '';
        if (!link) {
          link = entry.find('link').attr('href') ?? '';
        }

        const description =
          entry.find('content').text().trim() ||
          entry.find('summary').text().trim();
        const pubDate =
          entry.find('published').text().trim() ||
          entry.find('updated').text().trim();

        if (!title || !link) {
          return;
        }

        if (!this.isContestRelated(title, description)) {
          return;
        }

        const contest = this.buildRawContest(title, link, description, pubDate, feedUrl);
        contests.push(contest);
      } catch (error) {
        log.debug(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to parse Atom entry',
        );
      }
    });

    return contests;
  }

  /**
   * Build a RawContest from feed item fields.
   */
  private buildRawContest(
    title: string,
    link: string,
    description: string,
    _pubDate: string,
    feedUrl: string,
  ): RawContest {
    const normalizedUrl = normalizeUrl(link);
    const endDate = this.extractEndDate(description);
    const prizeDescription = this.extractPrize(description);
    const sponsor = this.extractSponsor(title, description);
    const entryMethod = this.detectEntryMethod(description);
    const type = this.inferType(title, description);

    return {
      url: normalizedUrl,
      title,
      sponsor,
      endDate,
      prizeDescription,
      source: feedUrl,
      entryMethod,
      type,
    };
  }

  /**
   * Check whether the item appears to be contest-related based on keywords.
   */
  private isContestRelated(title: string, description: string): boolean {
    const combined = `${title} ${description}`.toLowerCase();
    return CONTEST_KEYWORDS.some((keyword) => combined.includes(keyword));
  }

  /**
   * Extract an end date from the description HTML.
   */
  private extractEndDate(description: string): string {
    const plainText = this.stripHtml(description);

    for (const pattern of END_DATE_PATTERNS) {
      const match = plainText.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    return '';
  }

  /**
   * Extract prize information from the description.
   */
  private extractPrize(description: string): string {
    const plainText = this.stripHtml(description);

    // Look for dollar amounts
    const dollarMatch = plainText.match(/\$[\d,]+(?:\.\d{2})?/);
    if (dollarMatch) {
      // Get surrounding context
      const index = plainText.indexOf(dollarMatch[0]);
      const start = Math.max(0, index - 30);
      const end = Math.min(plainText.length, index + dollarMatch[0].length + 50);
      return plainText.slice(start, end).trim();
    }

    // Look for "prize" keyword context
    const prizeMatch = plainText.match(/prize[:\s]+(.{10,80})/i);
    if (prizeMatch?.[1]) {
      return prizeMatch[1].trim();
    }

    // Look for "win" keyword context
    const winMatch = plainText.match(/win\s+(?:a\s+)?(.{10,80})/i);
    if (winMatch?.[1]) {
      return winMatch[1].trim();
    }

    return '';
  }

  /**
   * Extract the sponsor name from title or description.
   */
  private extractSponsor(title: string, description: string): string {
    const combined = `${title} ${description}`;

    // "Sponsored by X", "From X", "by X"
    const sponsorMatch = combined.match(/(?:sponsored by|from|by)\s+([A-Z][\w\s&'.]+?)(?:\s*[-,.|]|\s+sweepstakes|\s+giveaway)/i);
    if (sponsorMatch?.[1]) {
      return sponsorMatch[1].trim();
    }

    // Often the first capitalized phrase in the title is the sponsor
    const titleMatch = title.match(/^([A-Z][\w\s&'.]+?)(?:\s+sweepstakes|\s+giveaway|\s+contest|\s*[-:|])/i);
    if (titleMatch?.[1]) {
      return titleMatch[1].trim();
    }

    return '';
  }

  /**
   * Detect entry method from description keywords.
   */
  private detectEntryMethod(description: string): string {
    const lower = description.toLowerCase();

    if (lower.includes('fill out') || lower.includes('form') || lower.includes('register')) {
      return 'form';
    }
    if (lower.includes('email') || lower.includes('subscribe') || lower.includes('newsletter')) {
      return 'email';
    }
    if (lower.includes('follow') || lower.includes('like') || lower.includes('share') || lower.includes('retweet')) {
      return 'social_follow';
    }
    if (lower.includes('instant win') || lower.includes('play')) {
      return 'form';
    }

    return 'form';
  }

  /**
   * Infer the contest type from keywords.
   */
  private inferType(title: string, description: string): string {
    const combined = `${title} ${description}`.toLowerCase();

    if (combined.includes('instant win') || combined.includes('instant-win')) {
      return 'instant_win';
    }
    if (combined.includes('daily')) {
      return 'daily_entry';
    }
    if (combined.includes('giveaway')) {
      return 'giveaway';
    }
    if (combined.includes('sweepstakes') || combined.includes('sweeps')) {
      return 'sweepstakes';
    }

    return 'sweepstakes';
  }

  /**
   * Strip HTML tags from a string.
   */
  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
