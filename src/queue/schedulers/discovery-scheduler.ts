/**
 * Periodic discovery scheduler.
 *
 * Queues discovery jobs for all active sources on a recurring basis,
 * with support for per-source custom schedules.
 *
 * Default schedule: every 4 hours for all active sources.
 * Per-source overrides: uses the `schedule` column from discovery_sources.
 */

import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import { getLogger } from '../../shared/logger.js';
import { QUEUE_NAMES } from '../../shared/constants.js';
import { getDb, schema } from '../../db/index.js';
import type { QueueManager } from '../queue-manager.js';

const log = getLogger('queue', { component: 'discovery-scheduler' });

type CronTask = ReturnType<typeof cron.schedule>;

interface SourceRecord {
  id: string;
  name: string;
  type: string;
  url: string | null;
  config: string | null;
  schedule: string | null;
  isActive: number;
}

export class DiscoveryScheduler {
  private readonly queueManager: QueueManager;
  private cronJobs: CronTask[] = [];
  private perSourceJobs = new Map<string, CronTask>();
  private running = false;

  constructor(queueManager: QueueManager) {
    this.queueManager = queueManager;
  }

  /**
   * Starts the discovery scheduler.
   *
   * Sets up:
   * - A global cron job that runs every 4 hours for sources without custom schedules.
   * - Per-source cron jobs for sources with a custom `schedule` column.
   */
  start(): void {
    if (this.running) {
      log.warn('DiscoveryScheduler already running');
      return;
    }

    // Global discovery: every 4 hours
    const globalCron = cron.schedule('0 */4 * * *', () => {
      this.queueAllDiscoveryJobs().catch((err) => {
        log.error({ err }, 'Failed to queue discovery jobs');
      });
    });
    this.cronJobs.push(globalCron);

    // Set up per-source custom schedules
    this.setupPerSourceSchedules().catch((err) => {
      log.error({ err }, 'Failed to set up per-source discovery schedules');
    });

    this.running = true;
    log.info('DiscoveryScheduler started');
  }

  /**
   * Stops all cron jobs (global and per-source).
   */
  stop(): void {
    for (const job of this.cronJobs) {
      job.stop();
    }
    this.cronJobs = [];

    for (const [sourceId, job] of this.perSourceJobs) {
      job.stop();
      log.debug({ sourceId }, 'Per-source cron job stopped');
    }
    this.perSourceJobs.clear();

    this.running = false;
    log.info('DiscoveryScheduler stopped');
  }

  /**
   * Triggers discovery for all active sources immediately, bypassing the schedule.
   */
  async triggerNow(): Promise<void> {
    log.info('Triggering immediate discovery for all active sources');
    await this.queueAllDiscoveryJobs();
  }

  // -------------------------------------------------------------------------
  // Internal logic
  // -------------------------------------------------------------------------

  /**
   * Queues discovery jobs for all active sources that do not have a custom schedule.
   * Sources with a custom schedule are handled by their per-source cron job.
   */
  private async queueAllDiscoveryJobs(): Promise<void> {
    const sources = await this.getActiveSources();

    if (sources.length === 0) {
      log.info('No active discovery sources found');
      return;
    }

    let queuedCount = 0;

    for (const source of sources) {
      // Skip sources with custom schedules (handled by per-source crons)
      // unless this is called from triggerNow()
      if (source.schedule && cron.validate(source.schedule)) {
        continue;
      }

      await this.queueDiscoveryForSource(source);
      queuedCount += 1;
    }

    log.info(
      { totalSources: sources.length, queuedCount },
      'Discovery jobs queued',
    );
  }

  /**
   * Sets up individual cron jobs for sources that have a custom schedule.
   */
  private async setupPerSourceSchedules(): Promise<void> {
    const sources = await this.getActiveSources();

    for (const source of sources) {
      if (!source.schedule) continue;

      if (!cron.validate(source.schedule)) {
        log.warn(
          { sourceId: source.id, schedule: source.schedule },
          'Invalid cron expression for source, using global schedule',
        );
        continue;
      }

      const task = cron.schedule(source.schedule, () => {
        this.queueDiscoveryForSource(source).catch((err) => {
          log.error(
            { err, sourceId: source.id },
            'Failed to queue per-source discovery job',
          );
        });
      });

      this.perSourceJobs.set(source.id, task);

      log.info(
        { sourceId: source.id, sourceName: source.name, schedule: source.schedule },
        'Per-source discovery cron job set up',
      );
    }
  }

  /**
   * Queues a single discovery job for a source.
   */
  private async queueDiscoveryForSource(source: SourceRecord): Promise<void> {
    let sourceConfig: Record<string, unknown> = {};
    try {
      sourceConfig = source.config ? (JSON.parse(source.config) as Record<string, unknown>) : {};
    } catch {
      log.warn({ sourceId: source.id }, 'Failed to parse source config, using empty config');
    }

    await this.queueManager.addJob(QUEUE_NAMES.DISCOVERY, {
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url ?? '',
      sourceType: source.type,
      sourceConfig,
    });

    log.debug(
      { sourceId: source.id, sourceName: source.name },
      'Discovery job queued',
    );
  }

  /**
   * Fetches all active discovery sources from the database.
   */
  private async getActiveSources(): Promise<SourceRecord[]> {
    const db = getDb();
    return db
      .select()
      .from(schema.discoverySources)
      .where(eq(schema.discoverySources.isActive, 1));
  }
}
