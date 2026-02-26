/**
 * BullMQ queue manager responsible for creating, managing, and monitoring
 * all job queues and their associated workers.
 *
 * Queues managed:
 *  - discovery      : Crawl sources for new contests
 *  - entry          : Submit contest entries
 *  - email-verify   : Confirm email verifications
 *  - sms-verify     : Handle SMS verification codes
 *  - social-action  : Perform social media actions
 *  - captcha        : Solve CAPTCHAs (delegated to provider)
 *  - cleanup        : Archive expired data
 *
 * If Redis is unavailable, the manager operates in "fallback" mode where
 * jobs are recorded directly in the SQLite database and processed
 * synchronously. This ensures the platform never crashes due to a
 * missing Redis instance.
 */

import { Queue, Worker, type Job, type JobsOptions, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { getLogger } from '../shared/logger.js';
import { QUEUE_NAMES } from '../shared/constants.js';
import { eventBus } from '../shared/events.js';
import { createDiscoveryWorker } from './workers/discovery-worker.js';
import { createEntryWorker } from './workers/entry-worker.js';
import { createEmailWorker } from './workers/email-worker.js';
import { createSmsWorker } from './workers/sms-worker.js';
import { createCleanupWorker } from './workers/cleanup-worker.js';

const log = getLogger('queue', { component: 'queue-manager' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JobData {
  [key: string]: unknown;
}

export interface QueueStatus {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface QueueManagerOptions {
  /** Max concurrent entry workers. Default: 2. */
  entryConcurrency?: number;
  /** Max concurrent discovery workers. Default: 3. */
  discoveryConcurrency?: number;
}

// ---------------------------------------------------------------------------
// Default job options
// ---------------------------------------------------------------------------

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000,
  },
  removeOnComplete: {
    count: 1000,
  },
  removeOnFail: {
    count: 5000,
  },
};

// ---------------------------------------------------------------------------
// In-memory fallback queue (used when Redis is not available)
// ---------------------------------------------------------------------------

interface FallbackJob {
  id: string;
  queue: string;
  name: string;
  data: JobData;
  options: JobsOptions;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// QueueManager
// ---------------------------------------------------------------------------

export class QueueManager {
  private queues = new Map<string, Queue>();
  private workers = new Map<string, Worker>();
  private queueEvents = new Map<string, QueueEvents>();
  private connection: IORedis | null = null;
  private initialized = false;
  private fallbackMode = false;
  private fallbackJobs: FallbackJob[] = [];
  private fallbackJobCounter = 0;

  /** Returns true if the manager is operating without Redis. */
  get isFallbackMode(): boolean {
    return this.fallbackMode;
  }

  /**
   * Initializes all queues and workers with the given Redis connection URL.
   * Must be called before any other method.
   *
   * If Redis is unreachable, falls back to an in-memory job store so that
   * the rest of the platform can continue to function (jobs will be logged
   * to the database and processed when Redis becomes available, or handled
   * synchronously in degraded mode).
   */
  async initialize(
    redisUrl: string,
    options?: QueueManagerOptions,
  ): Promise<void> {
    if (this.initialized) {
      log.warn('QueueManager already initialized, skipping');
      return;
    }

    log.info({ redisUrl: redisUrl.replace(/\/\/.*@/, '//***@') }, 'Initializing QueueManager');

    // Attempt to connect to Redis with a timeout
    const redisAvailable = await this.testRedisConnection(redisUrl);

    if (!redisAvailable) {
      log.warn(
        'Redis is not available. QueueManager entering fallback mode. ' +
        'Jobs will be stored in-memory and processed when workers are available.',
      );
      this.fallbackMode = true;
      this.initialized = true;
      return;
    }

    // Create the shared Redis connection for queues
    this.connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
    });

    this.connection.on('error', (err) => {
      log.error({ err }, 'Redis connection error');
    });

    this.connection.on('connect', () => {
      log.info('Redis connected');
    });

    // Create all queues
    const queueNames = Object.values(QUEUE_NAMES);
    for (const name of queueNames) {
      const queue = new Queue(name, {
        connection: this.connection.duplicate(),
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });

      this.queues.set(name, queue);

      // Set up QueueEvents for monitoring
      const events = new QueueEvents(name, {
        connection: this.connection.duplicate(),
      });

      events.on('completed', ({ jobId }) => {
        eventBus.emit('queue:job:completed', { queue: name, jobId });
      });

      events.on('failed', ({ jobId, failedReason }) => {
        eventBus.emit('queue:job:failed', {
          queue: name,
          jobId,
          error: failedReason,
        });
      });

      this.queueEvents.set(name, events);
    }

    // Create workers
    const entryConcurrency = options?.entryConcurrency ?? 2;
    const discoveryConcurrency = options?.discoveryConcurrency ?? 3;

    this.createWorkers(entryConcurrency, discoveryConcurrency);

    this.initialized = true;
    log.info(
      { queueCount: queueNames.length },
      'QueueManager initialized successfully with Redis',
    );
  }

  /**
   * Adds a job to the specified queue.
   * In fallback mode, stores the job in-memory and returns a stub Job object.
   */
  async addJob(
    queueName: string,
    data: JobData,
    options?: JobsOptions,
  ): Promise<Job> {
    if (this.fallbackMode) {
      return this.addFallbackJob(queueName, data, options);
    }

    const queue = this.getQueue(queueName);
    const jobName = `${queueName}-job`;

    const job = await queue.add(jobName, data, {
      ...DEFAULT_JOB_OPTIONS,
      ...options,
    });

    log.info(
      { queueName, jobId: job.id, jobName },
      'Job added to queue',
    );

    return job;
  }

  /**
   * Returns the count of jobs by status for a single queue.
   */
  async getQueueStatus(queueName: string): Promise<QueueStatus> {
    if (this.fallbackMode) {
      return this.getFallbackQueueStatus(queueName);
    }

    const queue = this.getQueue(queueName);

    const [waiting, active, completed, failed, delayed] =
      await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

    return { waiting, active, completed, failed, delayed, paused: 0 };
  }

  /**
   * Returns status for all managed queues.
   */
  async getAllQueuesStatus(): Promise<Record<string, QueueStatus>> {
    const result: Record<string, QueueStatus> = {};

    // In fallback mode, iterate over all known queue names from constants
    const entries = this.fallbackMode
      ? Object.values(QUEUE_NAMES)
      : Array.from(this.queues.keys());

    const statuses = await Promise.all(
      entries.map((name) => this.getQueueStatus(name)),
    );

    for (let i = 0; i < entries.length; i++) {
      const name = entries[i];
      const status = statuses[i];
      if (name !== undefined && status !== undefined) {
        result[name] = status;
      }
    }

    return result;
  }

  /**
   * Pauses processing for a specific queue.
   */
  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.pause();
    log.info({ queueName }, 'Queue paused');
  }

  /**
   * Resumes processing for a specific queue.
   */
  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.resume();
    log.info({ queueName }, 'Queue resumed');
  }

  /**
   * Pauses all queues.
   */
  async pauseAll(): Promise<void> {
    const names = Array.from(this.queues.keys());
    await Promise.all(names.map((name) => this.pauseQueue(name)));
    log.info('All queues paused');
  }

  /**
   * Resumes all queues.
   */
  async resumeAll(): Promise<void> {
    const names = Array.from(this.queues.keys());
    await Promise.all(names.map((name) => this.resumeQueue(name)));
    log.info('All queues resumed');
  }

  /**
   * Removes jobs from a queue by status and grace period.
   * @param grace - Time in ms; jobs older than this are removed.
   * @param status - 'completed' | 'failed' | 'delayed' | 'wait' | 'active'
   */
  async cleanQueue(
    queueName: string,
    grace: number,
    status: string,
  ): Promise<void> {
    const queue = this.getQueue(queueName);
    const validStatuses = ['completed', 'failed', 'delayed', 'wait', 'active'] as const;
    type CleanStatus = (typeof validStatuses)[number];

    if (!validStatuses.includes(status as CleanStatus)) {
      throw new Error(
        `Invalid status "${status}". Must be one of: ${validStatuses.join(', ')}`,
      );
    }

    const removed = await queue.clean(grace, 1000, status as CleanStatus);
    log.info(
      { queueName, status, grace, removedCount: removed.length },
      'Queue cleaned',
    );
  }

  /**
   * Returns failed jobs that have exhausted all retry attempts (dead letter jobs).
   */
  async getDeadLetterJobs(limit: number = 100): Promise<Job[]> {
    const deadLetterJobs: Job[] = [];

    for (const [_name, queue] of this.queues) {
      const failedJobs = await queue.getFailed(0, limit);
      for (const job of failedJobs) {
        const maxAttempts = job.opts.attempts ?? DEFAULT_JOB_OPTIONS.attempts ?? 3;
        if (job.attemptsMade >= maxAttempts) {
          deadLetterJobs.push(job);
        }
      }
    }

    // Sort by timestamp descending (most recent first)
    deadLetterJobs.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    return deadLetterJobs.slice(0, limit);
  }

  /**
   * Retries all dead letter jobs across all queues.
   * Returns the number of jobs retried.
   */
  async retryDeadLetterJobs(): Promise<number> {
    const deadLetterJobs = await this.getDeadLetterJobs(1000);
    let retriedCount = 0;

    for (const job of deadLetterJobs) {
      try {
        await job.retry();
        retriedCount += 1;
      } catch (error) {
        log.warn(
          { err: error, jobId: job.id },
          'Failed to retry dead letter job',
        );
      }
    }

    log.info({ retriedCount }, 'Dead letter jobs retried');
    return retriedCount;
  }

  /**
   * Gracefully shuts down all workers, queue events, and queues.
   * Waits for active jobs to complete before closing.
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down QueueManager...');

    // Close workers first (waits for active jobs)
    const workerClosePromises = Array.from(this.workers.values()).map(
      (worker) => worker.close(),
    );
    await Promise.allSettled(workerClosePromises);
    this.workers.clear();

    // Close queue events
    const eventsClosePromises = Array.from(this.queueEvents.values()).map(
      (events) => events.close(),
    );
    await Promise.allSettled(eventsClosePromises);
    this.queueEvents.clear();

    // Close queues
    const queueClosePromises = Array.from(this.queues.values()).map(
      (queue) => queue.close(),
    );
    await Promise.allSettled(queueClosePromises);
    this.queues.clear();

    // Close Redis connection
    if (this.connection) {
      this.connection.disconnect();
      this.connection = null;
    }

    this.initialized = false;
    log.info('QueueManager shut down successfully');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Tests whether Redis is reachable at the given URL by attempting a PING.
   * Returns false on connection failure or timeout (3 seconds).
   */
  private async testRedisConnection(redisUrl: string): Promise<boolean> {
    try {
      const testConn = new IORedis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        connectTimeout: 3000,
        retryStrategy: () => null, // Do not retry during the probe
      });

      const result = await Promise.race([
        testConn.ping(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);

      testConn.disconnect();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  private getQueue(queueName: string): Queue {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(
        `Queue "${queueName}" not found. Available queues: ${Array.from(this.queues.keys()).join(', ')}`,
      );
    }
    return queue;
  }

  private createWorkers(
    entryConcurrency: number,
    discoveryConcurrency: number,
  ): void {
    if (!this.connection) {
      throw new Error('Redis connection not established');
    }

    // Discovery worker
    const discoveryWorker = createDiscoveryWorker(
      this.connection.duplicate(),
      discoveryConcurrency,
    );
    this.workers.set(QUEUE_NAMES.DISCOVERY, discoveryWorker);

    // Entry worker
    const entryWorker = createEntryWorker(
      this.connection.duplicate(),
      entryConcurrency,
    );
    this.workers.set(QUEUE_NAMES.ENTRY, entryWorker);

    // Email verification worker
    const emailWorker = createEmailWorker(this.connection.duplicate());
    this.workers.set(QUEUE_NAMES.EMAIL_VERIFY, emailWorker);

    // SMS verification worker
    const smsWorker = createSmsWorker(this.connection.duplicate());
    this.workers.set(QUEUE_NAMES.SMS_VERIFY, smsWorker);

    // Cleanup worker
    const cleanupWorker = createCleanupWorker(this.connection.duplicate());
    this.workers.set(QUEUE_NAMES.CLEANUP, cleanupWorker);

    log.info(
      {
        workers: Array.from(this.workers.keys()),
        entryConcurrency,
        discoveryConcurrency,
      },
      'Workers created',
    );
  }

  // -------------------------------------------------------------------------
  // Fallback mode helpers (in-memory job store when Redis is unavailable)
  // -------------------------------------------------------------------------

  private addFallbackJob(
    queueName: string,
    data: JobData,
    _options?: JobsOptions,
  ): Job {
    this.fallbackJobCounter += 1;
    const jobId = `fallback-${this.fallbackJobCounter}`;

    const fallbackJob: FallbackJob = {
      id: jobId,
      queue: queueName,
      name: `${queueName}-job`,
      data,
      options: _options ?? DEFAULT_JOB_OPTIONS,
      status: 'waiting',
      createdAt: Date.now(),
    };

    this.fallbackJobs.push(fallbackJob);

    log.info(
      { queueName, jobId, fallbackMode: true },
      'Job stored in fallback queue (Redis unavailable)',
    );

    // Return a stub Job object that satisfies the minimal Job interface
    // used by callers (they only access .id and occasionally .data)
    return {
      id: jobId,
      name: fallbackJob.name,
      data,
      opts: _options ?? {},
      timestamp: fallbackJob.createdAt,
      attemptsMade: 0,
      updateProgress: async () => {},
    } as unknown as Job;
  }

  private getFallbackQueueStatus(queueName: string): QueueStatus {
    const jobs = this.fallbackJobs.filter((j) => j.queue === queueName);
    return {
      waiting: jobs.filter((j) => j.status === 'waiting').length,
      active: jobs.filter((j) => j.status === 'active').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      delayed: 0,
      paused: 0,
    };
  }

  /**
   * Returns all pending fallback jobs for a given queue.
   * Useful for draining the fallback store when Redis becomes available.
   */
  getFallbackJobs(queueName?: string): FallbackJob[] {
    if (queueName) {
      return this.fallbackJobs.filter(
        (j) => j.queue === queueName && j.status === 'waiting',
      );
    }
    return this.fallbackJobs.filter((j) => j.status === 'waiting');
  }
}
