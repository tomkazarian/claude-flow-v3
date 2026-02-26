/**
 * BullMQ worker for processing discovery jobs.
 *
 * Each job crawls a discovery source using the real discovery module
 * (SweepstakesCrawler, RSSFetcher, specialized source handlers),
 * deduplicates results against the database using ContestDeduplicator,
 * scores legitimacy with LegitimacyScorer, and persists newly discovered
 * contests to the SQLite database.
 */

import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { eq, sql } from 'drizzle-orm';
import { QUEUE_NAMES } from '../../shared/constants.js';
import { getLogger } from '../../shared/logger.js';
import { eventBus } from '../../shared/events.js';
import { AppError } from '../../shared/errors.js';
import { generateId } from '../../shared/crypto.js';
import { normalizeUrl, parseDate } from '../../shared/utils.js';
import { getDb, schema } from '../../db/index.js';

import { createSourceHandler } from '../../discovery/sources/index.js';
import { ContestDeduplicator } from '../../discovery/deduplicator.js';
import { LegitimacyScorer } from '../../discovery/legitimacy-scorer.js';
import type { DiscoverySource, CrawlResult } from '../../discovery/types.js';

const log = getLogger('queue', { component: 'discovery-worker' });

// ---------------------------------------------------------------------------
// Shared instances (reused across jobs within the same worker process)
// ---------------------------------------------------------------------------

const deduplicator = new ContestDeduplicator();
const legitimacyScorer = new LegitimacyScorer();
let deduplicatorInitialized = false;

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
): Promise<{ contestsFound: number; totalFetched: number; duplicates: number; filtered: number }> {
  const { sourceId, sourceName, sourceUrl, sourceType, sourceConfig } = job.data;

  log.info(
    { jobId: job.id, source: sourceName, type: sourceType, url: sourceUrl },
    'Starting discovery job',
  );

  eventBus.emit('discovery:started', { source: sourceName });

  await job.updateProgress(5);

  // Initialize deduplicator from DB on first run
  await initializeDeduplicator();

  await job.updateProgress(10);

  // Build a DiscoverySource config from the job data
  const discoverySource = buildDiscoverySource(sourceId, sourceName, sourceUrl, sourceType, sourceConfig);

  // Use the real discovery module to crawl the source
  let crawlResult: CrawlResult;
  try {
    const handler = createSourceHandler(discoverySource);
    log.info(
      { handler: handler.name, sourceId: discoverySource.id, url: discoverySource.url },
      'Crawling with handler',
    );
    crawlResult = await handler.crawl(discoverySource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(
      `Crawl failed for source "${sourceName}" (${sourceUrl}): ${message}`,
      'DISCOVERY_CRAWL_FAILED',
      502,
    );
  }

  await job.updateProgress(50);

  log.info(
    {
      source: sourceName,
      contestsFetched: crawlResult.contests.length,
      pagesCrawled: crawlResult.pagesCrawled,
      errors: crawlResult.errors.length,
    },
    'Crawl phase completed',
  );

  // Deduplicate, score legitimacy, and persist new contests
  const db = getDb();
  let newContestCount = 0;
  let duplicateCount = 0;
  let filteredCount = 0;

  for (const raw of crawlResult.contests) {
    // Deduplication using the real ContestDeduplicator
    const dedupResult = await deduplicator.isDuplicate(raw);
    if (dedupResult.isDuplicate) {
      log.debug(
        { url: raw.url, method: dedupResult.method },
        'Duplicate contest, skipping',
      );
      duplicateCount++;
      continue;
    }

    // Also check database directly in case deduplicator was not fully warm
    const normalizedUrl = normalizeUrl(raw.url);
    const existing = await db
      .select({ id: schema.contests.id })
      .from(schema.contests)
      .where(eq(schema.contests.url, normalizedUrl))
      .limit(1);

    if (existing.length > 0) {
      log.debug({ url: normalizedUrl }, 'Contest already in DB, skipping');
      deduplicator.markKnown(existing[0]!.id, raw);
      duplicateCount++;
      continue;
    }

    // Legitimacy scoring
    const legitimacyReport = legitimacyScorer.evaluate(raw);
    if (!legitimacyReport.passed) {
      log.info(
        { url: raw.url, score: legitimacyReport.score, summary: legitimacyReport.summary },
        'Contest failed legitimacy check, skipping',
      );
      filteredCount++;
      continue;
    }

    // Generate a stable external ID for this contest
    const externalId = deduplicator.generateExternalId(raw.url, raw.sponsor);

    // Parse the end date string into an ISO date
    const endDateParsed = raw.endDate ? parseDate(raw.endDate) : null;
    const endDateStr = endDateParsed ? endDateParsed.toISOString() : null;

    // Insert the new contest into the database
    const contestId = generateId();

    try {
      await db.insert(schema.contests).values({
        id: contestId,
        externalId,
        url: normalizedUrl,
        title: raw.title.slice(0, 500),
        sponsor: raw.sponsor || null,
        description: raw.prizeDescription || null,
        source: sourceName,
        sourceUrl: sourceUrl,
        type: mapContestType(raw.type),
        entryMethod: mapEntryMethod(raw.entryMethod),
        status: 'discovered',
        endDate: endDateStr,
        entryFrequency: mapEntryFrequency(raw.entryMethod, raw.type),
        prizeDescription: raw.prizeDescription || null,
        legitimacyScore: legitimacyReport.score,
        metadata: JSON.stringify({
          discoveredAt: new Date().toISOString(),
          sourceType,
          legitimacy: {
            score: legitimacyReport.score,
            summary: legitimacyReport.summary,
            factors: legitimacyReport.factors,
          },
          rawData: raw,
        }),
      });
    } catch (insertError) {
      // Handle unique constraint violations gracefully (race condition with concurrent workers)
      const msg = insertError instanceof Error ? insertError.message : String(insertError);
      if (msg.includes('UNIQUE constraint') || msg.includes('unique') || msg.includes('duplicate')) {
        log.debug({ url: normalizedUrl }, 'Contest already exists (unique constraint), skipping');
        duplicateCount++;
        continue;
      }
      throw insertError;
    }

    // Register in deduplicator for future checks within this session
    deduplicator.markKnown(contestId, raw);

    eventBus.emit('contest:discovered', {
      contestId,
      url: normalizedUrl,
      source: sourceName,
    });

    newContestCount++;
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

  const result = {
    contestsFound: newContestCount,
    totalFetched: crawlResult.contests.length,
    duplicates: duplicateCount,
    filtered: filteredCount,
  };

  log.info(
    {
      source: sourceName,
      ...result,
      pagesCrawled: crawlResult.pagesCrawled,
      durationMs: crawlResult.durationMs,
    },
    'Discovery job completed',
  );

  return result;
}

// ---------------------------------------------------------------------------
// Deduplicator initialization
// ---------------------------------------------------------------------------

/**
 * Load all existing contests from the database into the deduplicator
 * so it can detect duplicates without repeated DB queries.
 */
async function initializeDeduplicator(): Promise<void> {
  if (deduplicatorInitialized) return;

  try {
    const db = getDb();
    const existingContests = await db
      .select({
        id: schema.contests.id,
        url: schema.contests.url,
        title: schema.contests.title,
        sponsor: schema.contests.sponsor,
      })
      .from(schema.contests);

    for (const contest of existingContests) {
      deduplicator.registerExisting(
        contest.id,
        contest.url,
        contest.title,
        contest.sponsor ?? '',
      );
    }

    deduplicatorInitialized = true;
    log.info(
      { existingContests: existingContests.length },
      'Deduplicator initialized from database',
    );
  } catch (error) {
    log.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'Failed to initialize deduplicator from DB, will rely on DB-level dedup',
    );
    deduplicatorInitialized = true; // Don't retry on every job
  }
}

// ---------------------------------------------------------------------------
// Build a DiscoverySource from job data
// ---------------------------------------------------------------------------

function buildDiscoverySource(
  sourceId: string,
  sourceName: string,
  sourceUrl: string,
  sourceType: string,
  sourceConfig: Record<string, unknown>,
): DiscoverySource {
  // Map the DB source type to the discovery module's source type
  const typeMap: Record<string, 'html' | 'rss' | 'custom'> = {
    crawler: 'html',
    html: 'html',
    rss: 'rss',
    api: 'custom',
    social: 'custom',
    custom: 'custom',
  };

  // Map known source names to their specialized handler IDs
  const idMap: Record<string, string> = {
    sweepstakesadvantage: 'sweepstakes-advantage',
    'sweepstakes advantage': 'sweepstakes-advantage',
    'online-sweepstakes': 'online-sweepstakes',
    'online sweepstakes': 'online-sweepstakes',
    onlinesweepstakes: 'online-sweepstakes',
  };

  const normalizedName = sourceName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const handlerId = idMap[normalizedName] ?? sourceId;

  return {
    id: handlerId,
    name: sourceName,
    url: sourceUrl,
    type: typeMap[sourceType] ?? 'html',
    enabled: true,
    selectors: sourceConfig['selectors'] as DiscoverySource['selectors'],
    pagination: sourceConfig['pagination'] as DiscoverySource['pagination'],
    categories: sourceConfig['categories'] as string[] | undefined,
    maxPages: (sourceConfig['maxPages'] as number) ?? 5,
    rateLimitMs: (sourceConfig['rateLimitMs'] as number) ?? 2500,
  };
}

// ---------------------------------------------------------------------------
// Type mapping helpers
// ---------------------------------------------------------------------------

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
    social_comment: 'social',
    social_retweet: 'social',
    email: 'email',
    newsletter: 'email',
    purchase: 'purchase',
    multi: 'multi',
    referral_link: 'form',
    video_watch: 'form',
    survey: 'form',
    app_download: 'form',
  };
  return mapping[raw.toLowerCase()] ?? 'form';
}

function mapEntryFrequency(
  _entryMethod: string,
  contestType: string,
): 'daily' | 'once' | 'weekly' | 'unlimited' {
  const lower = contestType.toLowerCase();
  if (lower === 'daily_entry' || lower === 'daily') return 'daily';
  if (lower === 'instant_win') return 'daily';
  return 'once';
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
