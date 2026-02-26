/**
 * Recurring entry scheduler.
 *
 * Periodically finds contests eligible for re-entry (daily/weekly) and
 * queues entry jobs for eligible profile+contest pairs.
 *
 * Schedules:
 * - Every 6 hours: daily contests
 * - Every day at midnight: weekly contests
 */

import cron from 'node-cron';
import { and, eq, sql, desc, inArray } from 'drizzle-orm';
import { getLogger } from '../../shared/logger.js';
import { QUEUE_NAMES } from '../../shared/constants.js';
import { eventBus } from '../../shared/events.js';
import { getDb, schema } from '../../db/index.js';
import { calculatePriority } from '../priorities.js';
import type { QueueManager } from '../queue-manager.js';

const log = getLogger('queue', { component: 'recurring-entry-scheduler' });

/** node-cron ScheduledTask type. */
type CronTask = ReturnType<typeof cron.schedule>;

export class RecurringEntryScheduler {
  private readonly queueManager: QueueManager;
  private readonly maxEntriesPerHour: number;
  private cronJobs: CronTask[] = [];
  private running = false;

  constructor(
    queueManager: QueueManager,
    options?: {
      maxEntriesPerHour?: number;
    },
  ) {
    this.queueManager = queueManager;
    this.maxEntriesPerHour = options?.maxEntriesPerHour ?? 20;
  }

  /**
   * Starts the cron jobs for recurring entry scheduling.
   */
  start(): void {
    if (this.running) {
      log.warn('RecurringEntryScheduler already running');
      return;
    }

    // Every 6 hours: check for daily contests
    const dailyCron = cron.schedule('0 */6 * * *', () => {
      this.scheduleDailyEntries().catch((err) => {
        log.error({ err }, 'Failed to schedule daily entries');
      });
    });
    this.cronJobs.push(dailyCron);

    // Every day at midnight: check for weekly contests
    const weeklyCron = cron.schedule('0 0 * * *', () => {
      this.scheduleWeeklyEntries().catch((err) => {
        log.error({ err }, 'Failed to schedule weekly entries');
      });
    });
    this.cronJobs.push(weeklyCron);

    this.running = true;
    log.info(
      { maxEntriesPerHour: this.maxEntriesPerHour },
      'RecurringEntryScheduler started',
    );
  }

  /**
   * Stops all cron jobs.
   */
  stop(): void {
    for (const job of this.cronJobs) {
      job.stop();
    }
    this.cronJobs = [];
    this.running = false;
    log.info('RecurringEntryScheduler stopped');
  }

  // -------------------------------------------------------------------------
  // Scheduling logic
  // -------------------------------------------------------------------------

  /**
   * Finds daily-entry contests and queues entries for eligible profiles.
   */
  private async scheduleDailyEntries(): Promise<void> {
    log.info('Checking for daily contest entries...');

    const db = getDb();

    // Find active contests with daily entry frequency
    const dailyContests = await db
      .select()
      .from(schema.contests)
      .where(
        and(
          eq(schema.contests.entryFrequency, 'daily'),
          inArray(schema.contests.status, ['active', 'discovered']),
        ),
      )
      .orderBy(desc(schema.contests.priorityScore));

    if (dailyContests.length === 0) {
      log.info('No daily contests found');
      return;
    }

    // Get all active profiles
    const activeProfiles = await db
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.isActive, 1));

    if (activeProfiles.length === 0) {
      log.info('No active profiles found');
      return;
    }

    let queuedCount = 0;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();

    for (const contest of dailyContests) {
      // Rate limit check
      if (queuedCount >= this.maxEntriesPerHour) {
        log.info(
          { queuedCount, limit: this.maxEntriesPerHour },
          'Rate limit reached, stopping daily scheduling',
        );
        break;
      }

      for (const profile of activeProfiles) {
        if (queuedCount >= this.maxEntriesPerHour) break;

        // Check if this profile has already entered today
        const recentEntries = await db
          .select({ id: schema.entryLimits.id })
          .from(schema.entryLimits)
          .where(
            and(
              eq(schema.entryLimits.contestId, contest.id),
              eq(schema.entryLimits.profileId, profile.id),
              sql`${schema.entryLimits.lastEntryAt} >= ${todayStartIso}`,
            ),
          )
          .limit(1);

        if (recentEntries.length > 0) {
          log.debug(
            { contestId: contest.id, profileId: profile.id },
            'Profile already entered today, skipping',
          );
          continue;
        }

        // Calculate priority and queue the entry
        const priority = calculatePriority({
          id: contest.id,
          prizeValue: contest.prizeValue,
          endDate: contest.endDate,
          entryFrequency: contest.entryFrequency,
          difficultyScore: contest.difficultyScore,
          legitimacyScore: contest.legitimacyScore,
          type: contest.type,
        });

        await this.queueManager.addJob(
          QUEUE_NAMES.ENTRY,
          {
            contestId: contest.id,
            profileId: profile.id,
            contestUrl: contest.url,
            entryMethod: contest.entryMethod,
            priority,
          },
          {
            priority: Math.max(1, 100 - priority), // BullMQ: lower number = higher priority
            delay: queuedCount * 3000, // Stagger entries by 3 seconds
          },
        );

        eventBus.emit('entry:queued', {
          contestId: contest.id,
          profileId: profile.id,
          jobId: `daily-${contest.id}-${profile.id}`,
        });

        queuedCount += 1;
      }
    }

    log.info(
      {
        dailyContests: dailyContests.length,
        activeProfiles: activeProfiles.length,
        entriesQueued: queuedCount,
      },
      'Daily entry scheduling completed',
    );
  }

  /**
   * Finds weekly-entry contests and queues entries for eligible profiles.
   */
  private async scheduleWeeklyEntries(): Promise<void> {
    log.info('Checking for weekly contest entries...');

    const db = getDb();

    // Find active contests with weekly entry frequency
    const weeklyContests = await db
      .select()
      .from(schema.contests)
      .where(
        and(
          eq(schema.contests.entryFrequency, 'weekly'),
          inArray(schema.contests.status, ['active', 'discovered']),
        ),
      )
      .orderBy(desc(schema.contests.priorityScore));

    if (weeklyContests.length === 0) {
      log.info('No weekly contests found');
      return;
    }

    // Get all active profiles
    const activeProfiles = await db
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.isActive, 1));

    if (activeProfiles.length === 0) {
      log.info('No active profiles found');
      return;
    }

    let queuedCount = 0;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    for (const contest of weeklyContests) {
      if (queuedCount >= this.maxEntriesPerHour) {
        log.info(
          { queuedCount, limit: this.maxEntriesPerHour },
          'Rate limit reached, stopping weekly scheduling',
        );
        break;
      }

      for (const profile of activeProfiles) {
        if (queuedCount >= this.maxEntriesPerHour) break;

        // Check if this profile has entered within the last 7 days
        const recentEntries = await db
          .select({ id: schema.entryLimits.id })
          .from(schema.entryLimits)
          .where(
            and(
              eq(schema.entryLimits.contestId, contest.id),
              eq(schema.entryLimits.profileId, profile.id),
              sql`${schema.entryLimits.lastEntryAt} >= ${weekAgo}`,
            ),
          )
          .limit(1);

        if (recentEntries.length > 0) {
          log.debug(
            { contestId: contest.id, profileId: profile.id },
            'Profile already entered this week, skipping',
          );
          continue;
        }

        const priority = calculatePriority({
          id: contest.id,
          prizeValue: contest.prizeValue,
          endDate: contest.endDate,
          entryFrequency: contest.entryFrequency,
          difficultyScore: contest.difficultyScore,
          legitimacyScore: contest.legitimacyScore,
          type: contest.type,
        });

        await this.queueManager.addJob(
          QUEUE_NAMES.ENTRY,
          {
            contestId: contest.id,
            profileId: profile.id,
            contestUrl: contest.url,
            entryMethod: contest.entryMethod,
            priority,
          },
          {
            priority: Math.max(1, 100 - priority),
            delay: queuedCount * 5000, // Stagger weekly entries by 5 seconds
          },
        );

        eventBus.emit('entry:queued', {
          contestId: contest.id,
          profileId: profile.id,
          jobId: `weekly-${contest.id}-${profile.id}`,
        });

        queuedCount += 1;
      }
    }

    log.info(
      {
        weeklyContests: weeklyContests.length,
        activeProfiles: activeProfiles.length,
        entriesQueued: queuedCount,
      },
      'Weekly entry scheduling completed',
    );
  }
}
