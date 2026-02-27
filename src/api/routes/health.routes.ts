import type { FastifyInstance } from 'fastify';
import { getSqlite } from '../../db/index.js';

const startedAt = Date.now();

/**
 * Health check routes.
 * Provides system health status for monitoring and orchestration.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // GET / - System health overview
  app.get('/', async (_request, reply) => {
    const uptimeMs = Date.now() - startedAt;

    // Database: execute a real query to confirm connectivity
    let databaseStatus: 'ok' | 'error' = 'error';
    try {
      const sqlite = getSqlite();
      const row = sqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      databaseStatus = row?.ok === 1 ? 'ok' : 'error';
    } catch {
      // Database is not available
    }

    // Redis: real ping check
    let redisStatus: 'ok' | 'error' | 'not_configured' = 'not_configured';
    try {
      const { getRedis } = await import('../../queue/redis.js');
      const redis = getRedis();
      if (redis) {
        const pong = await redis.ping();
        redisStatus = pong === 'PONG' ? 'ok' : 'error';
      }
    } catch {
      redisStatus = 'error';
    }

    // Queues: derive status from Redis availability (queues require Redis)
    let queuesStatus: 'ok' | 'degraded' | 'not_configured' = 'not_configured';
    if (redisStatus === 'ok') {
      try {
        const { Queue } = await import('bullmq');
        const { getRedis } = await import('../../queue/redis.js');
        const redis = getRedis();
        if (redis) {
          const queue = new Queue('entry', { connection: redis });
          await queue.getWaitingCount(); // real connectivity check
          queuesStatus = 'ok';
          await queue.close();
        }
      } catch {
        queuesStatus = 'degraded';
      }
    } else if (redisStatus === 'error') {
      queuesStatus = 'degraded';
    }

    // Browser pool: report as not_configured since there is no live pool instance on the health endpoint
    const browserPoolStatus: 'ok' | 'not_configured' = 'not_configured';

    const isHealthy = databaseStatus === 'ok';
    const status = isHealthy ? 'healthy' : 'degraded';

    return reply.send({
      status,
      uptime: uptimeMs,
      uptimeHuman: formatUptime(uptimeMs),
      database: databaseStatus,
      redis: redisStatus,
      queues: queuesStatus,
      browserPool: browserPoolStatus,
      timestamp: new Date().toISOString(),
    });
  });

  // GET /services - Individual service status checks
  app.get('/services', async (_request, reply) => {
    const services: Record<string, { status: string; latencyMs?: number; details?: unknown }> = {};

    // Database check: execute a real query
    const dbStart = Date.now();
    try {
      const sqlite = getSqlite();
      const row = sqlite.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      if (row?.ok === 1) {
        services['database'] = {
          status: 'ok',
          latencyMs: Date.now() - dbStart,
        };
      } else {
        services['database'] = {
          status: 'error',
          latencyMs: Date.now() - dbStart,
          details: 'Query returned unexpected result',
        };
      }
    } catch (error) {
      services['database'] = {
        status: 'error',
        latencyMs: Date.now() - dbStart,
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Redis check
    const redisStart = Date.now();
    try {
      const { getRedis } = await import('../../queue/redis.js');
      const redis = getRedis();
      if (redis) {
        await redis.ping();
        services['redis'] = {
          status: 'ok',
          latencyMs: Date.now() - redisStart,
        };
      } else {
        services['redis'] = { status: 'not_configured' };
      }
    } catch (error) {
      services['redis'] = {
        status: 'error',
        latencyMs: Date.now() - redisStart,
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Queues check: verify at least one BullMQ queue is reachable
    const queuesStart = Date.now();
    if (services['redis']?.status === 'ok') {
      try {
        const { Queue } = await import('bullmq');
        const { getRedis } = await import('../../queue/redis.js');
        const redis = getRedis();
        if (redis) {
          const queue = new Queue('entry', { connection: redis });
          const waitingCount = await queue.getWaitingCount();
          services['queues'] = {
            status: 'ok',
            latencyMs: Date.now() - queuesStart,
            details: { waitingJobs: waitingCount },
          };
          await queue.close();
        } else {
          services['queues'] = { status: 'not_configured' };
        }
      } catch (error) {
        services['queues'] = {
          status: 'error',
          latencyMs: Date.now() - queuesStart,
          details: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    } else if (services['redis']?.status === 'not_configured') {
      services['queues'] = { status: 'not_configured' };
    } else {
      services['queues'] = {
        status: 'error',
        details: 'Redis unavailable, queues cannot function',
      };
    }

    // Browser pool: no persistent pool instance to check at this layer
    services['browserPool'] = { status: 'not_configured' };

    const allOk = Object.values(services).every((s) => s.status === 'ok' || s.status === 'not_configured');

    return reply.send({
      overall: allOk ? 'healthy' : 'degraded',
      services,
      timestamp: new Date().toISOString(),
    });
  });
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
