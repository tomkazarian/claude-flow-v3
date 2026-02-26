/**
 * BullMQ worker for processing entry submission jobs.
 *
 * Each job loads a contest and profile from the database, orchestrates
 * the entry flow (including form filling, CAPTCHA solving, etc.),
 * and records the result.
 */

import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { eq, sql } from 'drizzle-orm';
import { QUEUE_NAMES, DEFAULT_LIMITS } from '../../shared/constants.js';
import { getLogger } from '../../shared/logger.js';
import { eventBus } from '../../shared/events.js';
import { EntryError } from '../../shared/errors.js';
import { generateId } from '../../shared/crypto.js';
import { getDb, schema } from '../../db/index.js';
import { CircuitBreaker } from '../circuit-breaker.js';

const log = getLogger('queue', { component: 'entry-worker' });

// ---------------------------------------------------------------------------
// Circuit breaker (shared across all entry jobs, keyed by contest domain)
// ---------------------------------------------------------------------------

const circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  recoveryTimeoutMs: 60_000, // 1 minute
  halfOpenSuccessThreshold: 2,
});

// ---------------------------------------------------------------------------
// Job data shape
// ---------------------------------------------------------------------------

export interface EntryJobData {
  contestId: string;
  profileId: string;
  contestUrl: string;
  entryMethod: string;
  priority: number;
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Creates a BullMQ worker that processes entry submission jobs.
 */
export function createEntryWorker(
  connection: IORedis,
  concurrency: number = 2,
): Worker {
  const maxConcurrency = Math.min(
    concurrency,
    DEFAULT_LIMITS.MAX_BROWSER_INSTANCES,
  );

  const worker = new Worker<EntryJobData>(
    QUEUE_NAMES.ENTRY,
    async (job: Job<EntryJobData>) => {
      return processEntryJob(job);
    },
    {
      connection,
      concurrency: maxConcurrency,
      lockDuration: 180_000, // 3 minutes to allow for slow entries
      lockRenewTime: 60_000, // Renew lock every minute
    },
  );

  worker.on('completed', (job: Job<EntryJobData>, result: unknown) => {
    const res = result as { entryId: string; status: string } | undefined;
    log.info(
      {
        jobId: job.id,
        contestId: job.data.contestId,
        profileId: job.data.profileId,
        entryId: res?.entryId,
        status: res?.status,
      },
      'Entry job completed',
    );
  });

  worker.on('failed', (job: Job<EntryJobData> | undefined, error: Error) => {
    log.error(
      {
        jobId: job?.id,
        contestId: job?.data.contestId,
        profileId: job?.data.profileId,
        err: error,
        attemptsRemaining: job ? (job.opts.attempts ?? 3) - job.attemptsMade : 0,
      },
      'Entry job failed',
    );
  });

  worker.on('error', (error: Error) => {
    log.error({ err: error }, 'Entry worker error');
  });

  log.info({ concurrency: maxConcurrency }, 'Entry worker created');
  return worker;
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

async function processEntryJob(
  job: Job<EntryJobData>,
): Promise<{ entryId: string; status: string }> {
  const { contestId, profileId, contestUrl, entryMethod } = job.data;
  const entryId = generateId();
  const startTime = Date.now();

  log.info(
    {
      jobId: job.id,
      contestId,
      profileId,
      entryId,
      url: contestUrl,
      method: entryMethod,
    },
    'Starting entry job',
  );

  // ---------------------------------------------------------------------------
  // Circuit breaker check (keyed by domain)
  // ---------------------------------------------------------------------------
  let domain: string;
  try {
    domain = new URL(contestUrl).hostname;
  } catch {
    domain = contestUrl;
  }

  if (!circuitBreaker.canExecute(domain)) {
    log.warn(
      { domain, contestId, entryId },
      'Circuit breaker is open for domain, skipping entry',
    );
    throw new EntryError(
      `Circuit breaker open for domain ${domain}`,
      'CIRCUIT_BREAKER_OPEN',
      contestId,
      entryId,
    );
  }

  eventBus.emit('entry:started', { contestId, profileId, entryId });
  await job.updateProgress(10);

  // Load contest from database
  const db = getDb();
  const contestRows = await db
    .select()
    .from(schema.contests)
    .where(eq(schema.contests.id, contestId))
    .limit(1);

  const contest = contestRows[0];
  if (!contest) {
    throw new EntryError(
      `Contest not found: ${contestId}`,
      'CONTEST_NOT_FOUND',
      contestId,
      entryId,
      404,
    );
  }

  // Check contest is still active
  if (contest.status === 'expired' || contest.status === 'blocked') {
    throw new EntryError(
      `Contest is ${contest.status}: ${contestId}`,
      'CONTEST_NOT_ACTIVE',
      contestId,
      entryId,
    );
  }

  await job.updateProgress(20);

  // Load profile from database
  const profileRows = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, profileId))
    .limit(1);

  const profile = profileRows[0];
  if (!profile) {
    throw new EntryError(
      `Profile not found: ${profileId}`,
      'PROFILE_NOT_FOUND',
      contestId,
      entryId,
      404,
    );
  }

  if (!profile.isActive) {
    throw new EntryError(
      `Profile is inactive: ${profileId}`,
      'PROFILE_INACTIVE',
      contestId,
      entryId,
    );
  }

  await job.updateProgress(30);

  // Create entry record in pending state
  await db.insert(schema.entries).values({
    id: entryId,
    contestId,
    profileId,
    status: 'pending',
    attemptNumber: job.attemptsMade + 1,
    entryMethod,
  });

  let finalStatus: string = 'failed';
  let errorMessage: string | null = null;
  let screenshotPath: string | null = null;

  try {
    await job.updateProgress(50);

    // Execute the entry orchestration pipeline using the real EntryOrchestrator.
    // The orchestrator handles: browser acquisition, navigation, form analysis,
    // form filling, CAPTCHA solving, submission, confirmation detection,
    // screenshot capture, and browser release.
    const { EntryOrchestrator } = await import('../../entry/entry-orchestrator.js');
    const orchestrator = new EntryOrchestrator();

    // Attempt to set up the browser provider from the BrowserPool if available.
    // If no browser pool is available, the orchestrator will return a failure
    // result explaining the missing provider, which we handle below.
    let browserPool: Awaited<typeof import('../../browser/browser-pool.js')>['BrowserPool']['prototype'] | null = null;
    try {
      const { BrowserPool } = await import('../../browser/browser-pool.js');
      browserPool = new BrowserPool({
        maxInstances: 1,
        headless: process.env['BROWSER_HEADLESS'] !== 'false',
      });

      const capturedPool = browserPool;
      orchestrator.setBrowserProvider({
        acquire: async (_options) => {
          const context = await capturedPool.acquire();
          const pages = context.pages();
          const page = pages.length > 0 ? pages[0]! : await context.newPage();
          return {
            id: `ctx-${entryId}`,
            page: page as unknown as import('../../entry/types.js').Page,
          };
        },
        release: async (_ctx) => {
          // Pool handles context cleanup on destroy
          try {
            await capturedPool.destroy();
          } catch {
            // Best effort
          }
        },
      });
    } catch (browserErr) {
      log.warn(
        { err: browserErr },
        'BrowserPool not available; entry will be attempted without browser automation',
      );
    }

    // Build the Contest and Profile objects the orchestrator expects
    const orchestratorContest = {
      id: contest.id,
      url: contest.url,
      title: contest.title,
      type: contest.type,
      entryMethod: contest.entryMethod,
      entryFrequency: contest.entryFrequency ?? 'once',
      endDate: contest.endDate,
      ageRequirement: null as number | null,
      geoRestrictions: [] as string[],
      legitimacyScore: contest.legitimacyScore ?? 0.5,
      difficultyScore: contest.difficultyScore ?? 0.5,
      prizeValue: contest.prizeValue ?? 0,
      prizeDescription: contest.prizeDescription ?? '',
    };

    const orchestratorProfile = {
      id: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      phone: profile.phone ?? '',
      dateOfBirth: profile.dateOfBirth ?? '1990-01-01',
      address: profile.addressLine1 ?? '',
      city: profile.city ?? '',
      state: profile.state ?? '',
      zipCode: profile.zip ?? '',
      country: profile.country ?? 'US',
    };

    log.info(
      { entryId, contestUrl, method: entryMethod },
      'Executing entry submission via orchestrator',
    );

    const result = await orchestrator.enter(
      orchestratorContest as unknown as import('../../entry/types.js').Contest,
      orchestratorProfile as unknown as import('../../entry/types.js').Profile,
      { timeoutMs: 120_000, takeScreenshots: true },
    );

    await job.updateProgress(80);

    // Map orchestrator result to entry record status
    if (result.status === 'confirmed' || result.status === 'submitted') {
      finalStatus = result.status;
      const dbStatus = result.status as 'confirmed' | 'submitted';

      await db
        .update(schema.entries)
        .set({
          status: dbStatus,
          submittedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.entries.id, entryId));

      // Update entry limits tracking
      await updateEntryLimits(db, contestId, profileId);

      // Update contest status
      await db
        .update(schema.contests)
        .set({
          status: 'active',
          lastCheckedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.contests.id, contestId));

      // Record success on the circuit breaker
      circuitBreaker.recordSuccess(domain);

      eventBus.emit('entry:submitted', { entryId, contestId, profileId });
    } else {
      // Orchestrator returned a non-success status (failed, skipped)
      finalStatus = 'failed';
      errorMessage = result.message || 'Entry orchestrator returned non-success status';

      await db
        .update(schema.entries)
        .set({
          status: 'failed',
          errorMessage,
          errorScreenshot: result.screenshotPath ?? null,
          durationMs: Date.now() - startTime,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.entries.id, entryId));

      circuitBreaker.recordFailure(domain);
      eventBus.emit('entry:failed', { entryId, error: errorMessage });

      throw new EntryError(errorMessage, 'ENTRY_ORCHESTRATOR_FAILED', contestId, entryId);
    }

    await job.updateProgress(100);

    log.info(
      {
        entryId,
        contestId,
        profileId,
        status: finalStatus,
        durationMs: Date.now() - startTime,
      },
      'Entry submitted successfully via orchestrator',
    );
  } catch (error) {
    finalStatus = 'failed';
    errorMessage =
      error instanceof Error ? error.message : String(error);

    // Record failure on the circuit breaker
    circuitBreaker.recordFailure(domain);

    // Save error details
    await db
      .update(schema.entries)
      .set({
        status: 'failed',
        errorMessage,
        errorScreenshot: screenshotPath,
        durationMs: Date.now() - startTime,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.entries.id, entryId));

    eventBus.emit('entry:failed', { entryId, error: errorMessage });

    // Re-throw so BullMQ handles the retry logic
    throw error;
  }

  return { entryId, status: finalStatus };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function updateEntryLimits(
  db: ReturnType<typeof getDb>,
  contestId: string,
  profileId: string,
): Promise<void> {
  const now = new Date().toISOString();

  // Check for existing limit record
  const existing = await db
    .select()
    .from(schema.entryLimits)
    .where(eq(schema.entryLimits.contestId, contestId))
    .limit(1);

  const match = existing.find((e) => e.profileId === profileId);

  if (match) {
    await db
      .update(schema.entryLimits)
      .set({
        lastEntryAt: now,
        entryCount: sql`${schema.entryLimits.entryCount} + 1`,
      })
      .where(eq(schema.entryLimits.id, match.id));
  } else {
    await db.insert(schema.entryLimits).values({
      id: generateId(),
      contestId,
      profileId,
      lastEntryAt: now,
      entryCount: 1,
    });
  }
}
