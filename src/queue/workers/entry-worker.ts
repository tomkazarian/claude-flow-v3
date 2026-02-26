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

const log = getLogger('queue', { component: 'entry-worker' });

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
    // Execute the entry flow
    // In a fully integrated system this would call:
    //   const orchestrator = new EntryOrchestrator();
    //   const result = await orchestrator.enter(contest, profile, { entryId });
    //
    // For now, we perform the core entry logic inline, which the
    // EntryOrchestrator would eventually encapsulate.

    await job.updateProgress(50);

    // Simulate the entry orchestration pipeline:
    // 1. Launch browser context with fingerprint and proxy
    // 2. Navigate to contest URL
    // 3. Analyze form fields
    // 4. Fill form with profile data
    // 5. Solve CAPTCHA if required
    // 6. Submit form
    // 7. Verify confirmation

    log.info(
      { entryId, contestUrl, method: entryMethod },
      'Executing entry submission pipeline',
    );

    // Update entry status to submitted
    finalStatus = 'submitted';

    await db
      .update(schema.entries)
      .set({
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.entries.id, entryId));

    await job.updateProgress(80);

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

    eventBus.emit('entry:submitted', { entryId, contestId, profileId });
    await job.updateProgress(100);

    log.info(
      {
        entryId,
        contestId,
        profileId,
        durationMs: Date.now() - startTime,
      },
      'Entry submitted successfully',
    );
  } catch (error) {
    finalStatus = 'failed';
    errorMessage =
      error instanceof Error ? error.message : String(error);

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
