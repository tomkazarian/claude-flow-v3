/**
 * BullMQ worker for processing cleanup and maintenance jobs.
 *
 * Job types:
 * - expire-contests    : Mark contests past end_date as 'expired'
 * - clean-screenshots  : Remove screenshot files older than 30 days
 * - clean-queue-metrics: Remove stale queue metrics older than 90 days
 */

import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { lt, eq, and, sql } from 'drizzle-orm';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QUEUE_NAMES, PATHS } from '../../shared/constants.js';
import { getLogger } from '../../shared/logger.js';
import { eventBus } from '../../shared/events.js';
import { getDb, schema } from '../../db/index.js';

const log = getLogger('queue', { component: 'cleanup-worker' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum age for screenshots before deletion (30 days). */
const SCREENSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Maximum age for queue metrics before deletion (90 days). */
const METRICS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Job data shape
// ---------------------------------------------------------------------------

export type CleanupJobType =
  | 'expire-contests'
  | 'clean-screenshots'
  | 'clean-queue-metrics';

export interface CleanupJobData {
  type: CleanupJobType;
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Creates a BullMQ worker that processes cleanup jobs.
 */
export function createCleanupWorker(connection: IORedis): Worker {
  const worker = new Worker<CleanupJobData>(
    QUEUE_NAMES.CLEANUP,
    async (job: Job<CleanupJobData>) => {
      return processCleanupJob(job);
    },
    {
      connection,
      concurrency: 1, // Cleanup jobs should run serially
    },
  );

  worker.on('completed', (job: Job<CleanupJobData>, result: unknown) => {
    const res = result as { affected: number } | undefined;
    log.info(
      {
        jobId: job.id,
        type: job.data.type,
        affected: res?.affected ?? 0,
      },
      'Cleanup job completed',
    );
  });

  worker.on('failed', (job: Job<CleanupJobData> | undefined, error: Error) => {
    log.error(
      {
        jobId: job?.id,
        type: job?.data.type,
        err: error,
      },
      'Cleanup job failed',
    );
  });

  worker.on('error', (error: Error) => {
    log.error({ err: error }, 'Cleanup worker error');
  });

  log.info('Cleanup worker created');
  return worker;
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

async function processCleanupJob(
  job: Job<CleanupJobData>,
): Promise<{ affected: number }> {
  const { type } = job.data;

  log.info({ jobId: job.id, type }, 'Starting cleanup job');
  await job.updateProgress(10);

  switch (type) {
    case 'expire-contests':
      return expireContests(job);
    case 'clean-screenshots':
      return cleanScreenshots(job);
    case 'clean-queue-metrics':
      return cleanQueueMetrics(job);
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown cleanup job type: ${exhaustiveCheck}`);
    }
  }
}

// ---------------------------------------------------------------------------
// expire-contests
// ---------------------------------------------------------------------------

/**
 * Marks contests whose end_date is in the past as 'expired'.
 * Only processes contests that are currently in 'discovered' or 'active' status.
 */
async function expireContests(
  job: Job<CleanupJobData>,
): Promise<{ affected: number }> {
  const db = getDb();
  const now = new Date().toISOString();

  await job.updateProgress(30);

  // Find contests that have passed their end date and are not already expired/blocked
  const expiredContests = await db
    .select({ id: schema.contests.id, title: schema.contests.title })
    .from(schema.contests)
    .where(
      and(
        lt(schema.contests.endDate, now),
        sql`${schema.contests.status} NOT IN ('expired', 'blocked', 'invalid', 'completed')`,
      ),
    );

  await job.updateProgress(50);

  if (expiredContests.length === 0) {
    log.info('No contests to expire');
    await job.updateProgress(100);
    return { affected: 0 };
  }

  // Batch update all expired contests
  const expiredIds = expiredContests.map((c) => c.id);

  for (const id of expiredIds) {
    await db
      .update(schema.contests)
      .set({
        status: 'expired',
        updatedAt: now,
      })
      .where(eq(schema.contests.id, id));

    eventBus.emit('contest:expired', { contestId: id });
  }

  await job.updateProgress(100);

  log.info(
    { expiredCount: expiredIds.length },
    'Contests marked as expired',
  );

  return { affected: expiredIds.length };
}

// ---------------------------------------------------------------------------
// clean-screenshots
// ---------------------------------------------------------------------------

/**
 * Removes screenshot files older than 30 days from the screenshots directory.
 */
async function cleanScreenshots(
  job: Job<CleanupJobData>,
): Promise<{ affected: number }> {
  const screenshotDir = resolve(PATHS.SCREENSHOTS);

  if (!existsSync(screenshotDir)) {
    log.info({ dir: screenshotDir }, 'Screenshots directory does not exist, skipping');
    await job.updateProgress(100);
    return { affected: 0 };
  }

  await job.updateProgress(20);

  const cutoffTime = Date.now() - SCREENSHOT_MAX_AGE_MS;
  let deletedCount = 0;
  let errorCount = 0;

  const files = readdirSync(screenshotDir);
  const totalFiles = files.length;

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];
    if (!fileName) continue;

    const filePath = join(screenshotDir, fileName);

    try {
      const stats = statSync(filePath);

      if (stats.isFile() && stats.mtimeMs < cutoffTime) {
        unlinkSync(filePath);
        deletedCount += 1;
      }
    } catch (error) {
      log.warn({ err: error, file: fileName }, 'Failed to process screenshot file');
      errorCount += 1;
    }

    // Update progress periodically
    if (i % 50 === 0) {
      const progress = Math.min(90, 20 + Math.round((i / totalFiles) * 70));
      await job.updateProgress(progress);
    }
  }

  await job.updateProgress(100);

  log.info(
    {
      totalFiles,
      deletedCount,
      errorCount,
      cutoffDays: Math.round(SCREENSHOT_MAX_AGE_MS / (24 * 60 * 60 * 1000)),
    },
    'Screenshot cleanup completed',
  );

  return { affected: deletedCount };
}

// ---------------------------------------------------------------------------
// clean-queue-metrics
// ---------------------------------------------------------------------------

/**
 * Removes stale audit log entries older than 90 days.
 * In a production system, queue metrics would be stored in their own table;
 * here we clean the audit_log as the closest equivalent.
 */
async function cleanQueueMetrics(
  job: Job<CleanupJobData>,
): Promise<{ affected: number }> {
  const db = getDb();

  await job.updateProgress(30);

  const cutoffDate = new Date(Date.now() - METRICS_MAX_AGE_MS).toISOString();

  // Delete old audit log entries
  const result = await db
    .delete(schema.auditLog)
    .where(lt(schema.auditLog.createdAt, cutoffDate));

  const affectedCount = (result as { changes?: number }).changes ?? 0;

  await job.updateProgress(70);

  // Also clean old cost log entries beyond 90 days
  const costResult = await db
    .delete(schema.costLog)
    .where(lt(schema.costLog.createdAt, cutoffDate));

  const costAffected = (costResult as { changes?: number }).changes ?? 0;

  await job.updateProgress(100);

  log.info(
    {
      auditLogsDeleted: affectedCount,
      costLogsDeleted: costAffected,
      cutoffDate,
    },
    'Queue metrics cleanup completed',
  );

  return { affected: affectedCount + costAffected };
}
