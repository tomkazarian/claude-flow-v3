/**
 * BullMQ worker for processing discovery jobs.
 *
 * Each job crawls a discovery source, finds new contests, deduplicates
 * them against the database, and persists newly discovered ones.
 */

import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { eq, sql } from 'drizzle-orm';
import { QUEUE_NAMES } from '../../shared/constants.js';
import { getLogger } from '../../shared/logger.js';
import { eventBus } from '../../shared/events.js';
import { AppError } from '../../shared/errors.js';
import { generateId } from '../../shared/crypto.js';
import { normalizeUrl } from '../../shared/utils.js';
import { getDb, schema } from '../../db/index.js';

const log = getLogger('queue', { component: 'discovery-worker' });

// ---------------------------------------------------------------------------
// Job data shape
// ---------------------------------------------------------------------------

export interface DiscoveryJobData {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  sourceType: string;
  sourceConfig: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Creates a BullMQ worker that processes discovery queue jobs.
 */
export function createDiscoveryWorker(
  connection: IORedis,
  concurrency: number = 3,
): Worker {
  const worker = new Worker<DiscoveryJobData>(
    QUEUE_NAMES.DISCOVERY,
    async (job: Job<DiscoveryJobData>) => {
      return processDiscoveryJob(job);
    },
    {
      connection,
      concurrency,
      limiter: {
        max: 5,
        duration: 60_000, // max 5 discovery jobs per minute
      },
    },
  );

  worker.on('completed', (job: Job<DiscoveryJobData>, result: unknown) => {
    const res = result as { contestsFound: number } | undefined;
    log.info(
      {
        jobId: job.id,
        source: job.data.sourceName,
        contestsFound: res?.contestsFound ?? 0,
      },
      'Discovery job completed',
    );

    eventBus.emit('discovery:completed', {
      source: job.data.sourceName,
      contestsFound: res?.contestsFound ?? 0,
    });
  });

  worker.on('failed', (job: Job<DiscoveryJobData> | undefined, error: Error) => {
    log.error(
      {
        jobId: job?.id,
        source: job?.data.sourceName,
        err: error,
      },
      'Discovery job failed',
    );

    // Increment error count for the source
    if (job?.data.sourceId) {
      incrementSourceErrorCount(job.data.sourceId).catch((err) => {
        log.error({ err, sourceId: job.data.sourceId }, 'Failed to increment source error count');
      });
    }
  });

  worker.on('error', (error: Error) => {
    log.error({ err: error }, 'Discovery worker error');
  });

  log.info({ concurrency }, 'Discovery worker created');
  return worker;
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

async function processDiscoveryJob(
  job: Job<DiscoveryJobData>,
): Promise<{ contestsFound: number }> {
  const { sourceId, sourceName, sourceUrl, sourceType, sourceConfig } = job.data;

  log.info(
    { jobId: job.id, source: sourceName, type: sourceType, url: sourceUrl },
    'Starting discovery job',
  );

  eventBus.emit('discovery:started', { source: sourceName });

  await job.updateProgress(10);

  // Fetch contests from the source based on type
  const rawContests = await fetchContestsFromSource(
    sourceUrl,
    sourceType,
    sourceConfig,
  );

  await job.updateProgress(50);

  // Deduplicate against existing contests in the database
  const db = getDb();
  let newContestCount = 0;

  for (const raw of rawContests) {
    const normalizedUrl = normalizeUrl(raw.url);

    // Check for existing contest by URL
    const existing = await db
      .select({ id: schema.contests.id })
      .from(schema.contests)
      .where(eq(schema.contests.url, normalizedUrl))
      .limit(1);

    if (existing.length > 0) {
      log.debug({ url: normalizedUrl }, 'Contest already exists, skipping');
      continue;
    }

    // Insert new contest
    const contestId = generateId();

    await db.insert(schema.contests).values({
      id: contestId,
      externalId: raw.externalId || generateId(),
      url: normalizedUrl,
      title: raw.title,
      sponsor: raw.sponsor || null,
      description: raw.description || null,
      source: sourceName,
      sourceUrl: sourceUrl,
      type: mapContestType(raw.type),
      entryMethod: mapEntryMethod(raw.entryMethod),
      status: 'discovered',
      startDate: raw.startDate || null,
      endDate: raw.endDate || null,
      entryFrequency: (raw.entryFrequency || 'once') as 'daily' | 'once' | 'weekly' | 'unlimited',
      prizeDescription: raw.prizeDescription || null,
      prizeValue: raw.prizeValue ?? null,
      metadata: JSON.stringify({
        discoveredAt: new Date().toISOString(),
        sourceType,
        rawData: raw,
      }),
    });

    eventBus.emit('contest:discovered', {
      contestId,
      url: normalizedUrl,
      source: sourceName,
    });

    newContestCount += 1;
  }

  await job.updateProgress(90);

  // Update the source's last_run_at and contests_found
  await db
    .update(schema.discoverySources)
    .set({
      lastRunAt: new Date().toISOString(),
      contestsFound: sql`${schema.discoverySources.contestsFound} + ${newContestCount}`,
    })
    .where(eq(schema.discoverySources.id, sourceId));

  await job.updateProgress(100);

  log.info(
    {
      source: sourceName,
      totalFetched: rawContests.length,
      newContests: newContestCount,
      duplicates: rawContests.length - newContestCount,
    },
    'Discovery job processed',
  );

  return { contestsFound: newContestCount };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RawDiscoveredContest {
  url: string;
  title: string;
  sponsor?: string;
  description?: string;
  externalId?: string;
  type: string;
  entryMethod: string;
  startDate?: string;
  endDate?: string;
  entryFrequency?: string;
  prizeDescription?: string;
  prizeValue?: number;
}

/**
 * Fetches contests from a source URL based on the source type.
 * This delegates to the appropriate fetcher (crawler, RSS parser, API client).
 *
 * In production, this would invoke the actual discovery module crawlers.
 * The implementation here provides the integration point.
 */
async function fetchContestsFromSource(
  sourceUrl: string,
  sourceType: string,
  _sourceConfig: Record<string, unknown>,
): Promise<RawDiscoveredContest[]> {
  try {
    switch (sourceType) {
      case 'crawler':
      case 'html': {
        // Import and use the HTML crawler from the discovery module
        // In a fully integrated system: const crawler = new HtmlCrawler(sourceConfig);
        // return await crawler.crawl(sourceUrl);
        log.info({ sourceUrl, sourceType }, 'Crawler source processing');
        return await crawlHtmlSource(sourceUrl);
      }

      case 'rss': {
        log.info({ sourceUrl, sourceType }, 'RSS source processing');
        return await fetchRssSource(sourceUrl);
      }

      case 'api': {
        log.info({ sourceUrl, sourceType }, 'API source processing');
        return await fetchApiSource(sourceUrl);
      }

      default:
        log.warn({ sourceType }, 'Unknown source type, attempting generic fetch');
        return await crawlHtmlSource(sourceUrl);
    }
  } catch (error) {
    throw new AppError(
      `Failed to fetch contests from source: ${sourceUrl}`,
      'DISCOVERY_FETCH_ERROR',
      502,
    );
  }
}

async function crawlHtmlSource(sourceUrl: string): Promise<RawDiscoveredContest[]> {
  // Dynamic import to avoid loading heavy dependencies unless needed
  const { default: got } = await import('got');
  const cheerio = await import('cheerio');

  const response = await got(sourceUrl, {
    timeout: { request: 30_000 },
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
  });

  const $ = cheerio.load(response.body);
  const contests: RawDiscoveredContest[] = [];

  // Generic contest link extraction - look for common patterns
  $('a[href*="sweepstakes"], a[href*="giveaway"], a[href*="contest"], a[href*="win"]').each(
    (_index, element) => {
      const href = $(element).attr('href');
      const title = $(element).text().trim();

      if (href && title && title.length > 5) {
        const absoluteUrl = href.startsWith('http')
          ? href
          : new URL(href, sourceUrl).toString();

        contests.push({
          url: absoluteUrl,
          title: title.slice(0, 500),
          type: 'sweepstakes',
          entryMethod: 'form',
        });
      }
    },
  );

  return contests;
}

async function fetchRssSource(sourceUrl: string): Promise<RawDiscoveredContest[]> {
  const { default: got } = await import('got');
  const cheerio = await import('cheerio');

  const response = await got(sourceUrl, {
    timeout: { request: 30_000 },
  });

  const $ = cheerio.load(response.body, { xmlMode: true });
  const contests: RawDiscoveredContest[] = [];

  $('item').each((_index, element) => {
    const title = $(element).find('title').text().trim();
    const link = $(element).find('link').text().trim();
    const description = $(element).find('description').text().trim();

    if (link && title) {
      contests.push({
        url: link,
        title: title.slice(0, 500),
        description: description.slice(0, 2000),
        type: 'sweepstakes',
        entryMethod: 'form',
      });
    }
  });

  return contests;
}

async function fetchApiSource(sourceUrl: string): Promise<RawDiscoveredContest[]> {
  const { default: got } = await import('got');

  const response = await got(sourceUrl, {
    timeout: { request: 30_000 },
    responseType: 'json',
  });

  const data = response.body as Record<string, unknown>;
  const items = (Array.isArray(data) ? data : (data['contests'] ?? data['items'] ?? [])) as Array<
    Record<string, unknown>
  >;

  return items
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && typeof item['url'] === 'string',
    )
    .map((item) => ({
      url: item['url'] as string,
      title: (item['title'] as string) ?? 'Untitled Contest',
      sponsor: item['sponsor'] as string | undefined,
      description: item['description'] as string | undefined,
      type: (item['type'] as string) ?? 'sweepstakes',
      entryMethod: (item['entryMethod'] as string) ?? 'form',
      endDate: item['endDate'] as string | undefined,
      prizeDescription: item['prizeDescription'] as string | undefined,
      prizeValue: typeof item['prizeValue'] === 'number' ? item['prizeValue'] : undefined,
    }));
}

function mapContestType(
  raw: string,
): 'sweepstakes' | 'raffle' | 'giveaway' | 'instant_win' | 'contest' | 'daily' {
  const mapping: Record<string, 'sweepstakes' | 'raffle' | 'giveaway' | 'instant_win' | 'contest' | 'daily'> = {
    sweepstakes: 'sweepstakes',
    raffle: 'raffle',
    giveaway: 'giveaway',
    instant_win: 'instant_win',
    contest: 'contest',
    daily: 'daily',
    daily_entry: 'daily',
    social_media: 'contest',
  };
  return mapping[raw.toLowerCase()] ?? 'sweepstakes';
}

function mapEntryMethod(
  raw: string,
): 'form' | 'social' | 'email' | 'purchase' | 'multi' {
  const mapping: Record<string, 'form' | 'social' | 'email' | 'purchase' | 'multi'> = {
    form: 'form',
    social: 'social',
    social_follow: 'social',
    social_share: 'social',
    social_like: 'social',
    email: 'email',
    newsletter: 'email',
    purchase: 'purchase',
    multi: 'multi',
  };
  return mapping[raw.toLowerCase()] ?? 'form';
}

async function incrementSourceErrorCount(sourceId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.discoverySources)
    .set({
      errorCount: sql`${schema.discoverySources.errorCount} + 1`,
    })
    .where(eq(schema.discoverySources.id, sourceId));
}
