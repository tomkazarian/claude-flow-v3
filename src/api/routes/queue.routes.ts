import type { FastifyInstance, FastifyReply } from 'fastify';
import { getLogger } from '../../shared/logger.js';
import { QUEUE_NAMES } from '../../shared/constants.js';

const logger = getLogger('server', { component: 'queue' });

/**
 * Queue management routes.
 * Provides visibility into BullMQ job queues and controls for
 * pausing, resuming, and retrying jobs.
 */
export async function queueRoutes(app: FastifyInstance): Promise<void> {
  // GET /status - Status of all queues
  app.get('/status', async (_request, reply: FastifyReply) => {
    const queues: Record<string, unknown> = {};

    for (const queueName of Object.values(QUEUE_NAMES)) {
      try {
        const { Queue } = await import('bullmq');
        const { getRedis } = await import('../../queue/redis.js');
        const redis = getRedis();

        if (!redis) {
          queues[queueName] = { status: 'not_configured' };
          continue;
        }

        const queue = new Queue(queueName, { connection: redis });
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
        ]);

        queues[queueName] = {
          status: 'active',
          waiting,
          active,
          completed,
          failed,
          delayed,
        };

        await queue.close();
      } catch {
        queues[queueName] = {
          status: 'error',
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        };
      }
    }

    return reply.send({ data: queues });
  });

  // GET /jobs - List jobs with filtering
  app.get('/jobs', async (request, reply: FastifyReply) => {
    const query = request.query as {
      queue?: string;
      status?: string;
      limit?: string;
    };

    const queueName = query.queue ?? QUEUE_NAMES.ENTRY;
    const status = query.status ?? 'active';
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 100);

    try {
      const { Queue } = await import('bullmq');
      const { getRedis } = await import('../../queue/redis.js');
      const redis = getRedis();

      if (!redis) {
        return reply.send({ data: [], message: 'Redis not configured' });
      }

      const queue = new Queue(queueName, { connection: redis });

      let jobs;
      switch (status) {
        case 'waiting':
          jobs = await queue.getWaiting(0, limit - 1);
          break;
        case 'active':
          jobs = await queue.getActive(0, limit - 1);
          break;
        case 'completed':
          jobs = await queue.getCompleted(0, limit - 1);
          break;
        case 'failed':
          jobs = await queue.getFailed(0, limit - 1);
          break;
        case 'delayed':
          jobs = await queue.getDelayed(0, limit - 1);
          break;
        default:
          jobs = await queue.getJobs([status as 'active'], 0, limit - 1);
      }

      const formatted = jobs.map((job) => ({
        id: job.id,
        name: job.name,
        data: job.data,
        status: job.finishedOn ? 'completed' : job.failedReason ? 'failed' : 'active',
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      }));

      await queue.close();

      return reply.send({ data: formatted });
    } catch (error) {
      logger.warn({ err: error, queueName }, 'Failed to list queue jobs');
      return reply.send({ data: [], message: 'Unable to fetch jobs' });
    }
  });

  // POST /pause - Pause all queues
  app.post('/pause', async (_request, reply: FastifyReply) => {
    const results: Record<string, string> = {};

    for (const queueName of Object.values(QUEUE_NAMES)) {
      try {
        const { Queue } = await import('bullmq');
        const { getRedis } = await import('../../queue/redis.js');
        const redis = getRedis();

        if (!redis) {
          results[queueName] = 'not_configured';
          continue;
        }

        const queue = new Queue(queueName, { connection: redis });
        await queue.pause();
        results[queueName] = 'paused';
        await queue.close();
      } catch {
        results[queueName] = 'error';
      }
    }

    logger.info('All queues paused');
    return reply.send({ data: results, message: 'Queues paused' });
  });

  // POST /resume - Resume all queues
  app.post('/resume', async (_request, reply: FastifyReply) => {
    const results: Record<string, string> = {};

    for (const queueName of Object.values(QUEUE_NAMES)) {
      try {
        const { Queue } = await import('bullmq');
        const { getRedis } = await import('../../queue/redis.js');
        const redis = getRedis();

        if (!redis) {
          results[queueName] = 'not_configured';
          continue;
        }

        const queue = new Queue(queueName, { connection: redis });
        await queue.resume();
        results[queueName] = 'resumed';
        await queue.close();
      } catch {
        results[queueName] = 'error';
      }
    }

    logger.info('All queues resumed');
    return reply.send({ data: results, message: 'Queues resumed' });
  });

  // POST /retry-failed - Retry all failed jobs
  app.post('/retry-failed', async (_request, reply: FastifyReply) => {
    const results: Record<string, { retried: number }> = {};

    for (const queueName of Object.values(QUEUE_NAMES)) {
      try {
        const { Queue } = await import('bullmq');
        const { getRedis } = await import('../../queue/redis.js');
        const redis = getRedis();

        if (!redis) {
          results[queueName] = { retried: 0 };
          continue;
        }

        const queue = new Queue(queueName, { connection: redis });
        const failed = await queue.getFailed(0, 500);
        let retried = 0;

        for (const job of failed) {
          try {
            await job.retry();
            retried++;
          } catch {
            // Job may have been removed or already retried
          }
        }

        results[queueName] = { retried };
        await queue.close();
      } catch {
        results[queueName] = { retried: 0 };
      }
    }

    logger.info({ results }, 'Failed jobs retried');
    return reply.send({ data: results, message: 'Failed jobs retried' });
  });

  // DELETE /dead-letter - Clear dead letter queue
  app.delete('/dead-letter', async (_request, reply: FastifyReply) => {
    const results: Record<string, { cleared: number }> = {};

    for (const queueName of Object.values(QUEUE_NAMES)) {
      try {
        const { Queue } = await import('bullmq');
        const { getRedis } = await import('../../queue/redis.js');
        const redis = getRedis();

        if (!redis) {
          results[queueName] = { cleared: 0 };
          continue;
        }

        const queue = new Queue(queueName, { connection: redis });
        const failed = await queue.getFailed(0, 1000);
        let cleared = 0;

        for (const job of failed) {
          try {
            await job.remove();
            cleared++;
          } catch {
            // Already removed
          }
        }

        results[queueName] = { cleared };
        await queue.close();
      } catch {
        results[queueName] = { cleared: 0 };
      }
    }

    logger.info({ results }, 'Dead letter queue cleared');
    return reply.send({ data: results, message: 'Dead letter queue cleared' });
  });

  // GET /metrics - Queue performance metrics
  app.get('/metrics', async (_request, reply: FastifyReply) => {
    const metrics: Record<string, unknown> = {};

    for (const queueName of Object.values(QUEUE_NAMES)) {
      try {
        const { Queue } = await import('bullmq');
        const { getRedis } = await import('../../queue/redis.js');
        const redis = getRedis();

        if (!redis) {
          metrics[queueName] = { status: 'not_configured' };
          continue;
        }

        const queue = new Queue(queueName, { connection: redis });
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
        ]);

        const isPaused = await queue.isPaused();

        metrics[queueName] = {
          isPaused,
          counts: { waiting, active, completed, failed, delayed },
          total: waiting + active + completed + failed + delayed,
          failureRate:
            completed + failed > 0
              ? Math.round((failed / (completed + failed)) * 10000) / 100
              : 0,
        };

        await queue.close();
      } catch {
        metrics[queueName] = { status: 'error' };
      }
    }

    return reply.send({ data: metrics });
  });
}
