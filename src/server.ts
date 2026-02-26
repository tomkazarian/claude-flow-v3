import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { registerRoutes } from './api/index.js';
import { globalErrorHandler } from './api/middleware/error-handler.js';
import { getLogger } from './shared/logger.js';

const logger = getLogger('server');

/**
 * Creates and configures the Fastify server instance.
 *
 * - CORS (all origins in development)
 * - Static file serving for the React SPA in production
 * - API routes under /api/v1
 * - Global error handler with structured JSON responses
 * - Health check at GET /api/v1/health
 * - SPA catch-all for non-API routes in production
 */
export async function createServer(): Promise<FastifyInstance> {
  const isProduction = process.env['NODE_ENV'] === 'production';

  const app = Fastify({
    logger: false, // We use our own pino logger
    requestTimeout: 30_000,
    bodyLimit: 1_048_576, // 1 MB
  });

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------
  await app.register(fastifyCors, {
    origin: isProduction
      ? (process.env['CORS_ORIGIN'] ?? false)
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // ---------------------------------------------------------------------------
  // Static file serving (production SPA)
  // ---------------------------------------------------------------------------
  const distClientPath = resolve(process.cwd(), 'dist', 'client');

  if (isProduction && existsSync(distClientPath)) {
    await app.register(fastifyStatic, {
      root: distClientPath,
      prefix: '/',
      wildcard: false,
      decorateReply: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Global error handler
  // ---------------------------------------------------------------------------
  app.setErrorHandler(globalErrorHandler);

  // ---------------------------------------------------------------------------
  // Request logging
  // ---------------------------------------------------------------------------
  app.addHook('onRequest', (request, _reply, done) => {
    logger.debug(
      { method: request.method, url: request.url, id: request.id },
      'Incoming request',
    );
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    logger.debug(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'Request completed',
    );
    done();
  });

  // ---------------------------------------------------------------------------
  // API routes
  // ---------------------------------------------------------------------------
  await registerRoutes(app);

  // ---------------------------------------------------------------------------
  // SPA catch-all (production only)
  // ---------------------------------------------------------------------------
  if (isProduction && existsSync(distClientPath)) {
    app.setNotFoundHandler((_request, reply) => {
      const indexPath = join(distClientPath, 'index.html');
      if (existsSync(indexPath)) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    });
  } else {
    app.setNotFoundHandler((_request, reply) => {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------
  const FORCE_KILL_TIMEOUT_MS = 30_000;
  let isShuttingDown = false;

  const gracefulShutdown = async (reason: string) => {
    if (isShuttingDown) {
      logger.warn({ reason }, 'Shutdown already in progress, ignoring duplicate signal');
      return;
    }
    isShuttingDown = true;

    logger.info({ reason }, 'Initiating graceful shutdown');

    // Force-kill safety net: if shutdown takes too long, exit hard
    const forceKillTimer = setTimeout(() => {
      logger.fatal('Graceful shutdown timed out after 30s, forcing exit');
      process.exit(1);
    }, FORCE_KILL_TIMEOUT_MS);
    forceKillTimer.unref();

    // 1. Stop accepting new HTTP requests
    try {
      await app.close();
      logger.info('Fastify server closed');
    } catch (error) {
      logger.error({ err: error }, 'Error during Fastify server close');
    }

    // 2. Close all queue workers, queue events, and queues via QueueManager
    try {
      const qm = (app as unknown as Record<string, unknown>)['queueManager'];
      if (qm && typeof (qm as { shutdown: () => Promise<void> }).shutdown === 'function') {
        await (qm as { shutdown: () => Promise<void> }).shutdown();
        logger.info('Queue workers and queues closed');
      }
    } catch (error) {
      logger.error({ err: error }, 'Error closing queue workers');
    }

    // 3. Stop all schedulers
    try {
      const schedulers = (app as unknown as Record<string, unknown>)['schedulers'];
      if (Array.isArray(schedulers)) {
        for (const sched of schedulers) {
          if (sched && typeof (sched as { stop: () => void }).stop === 'function') {
            (sched as { stop: () => void }).stop();
          }
        }
        logger.info('Schedulers stopped');
      }
    } catch (error) {
      logger.error({ err: error }, 'Error stopping schedulers');
    }

    // 4. Drain the browser pool (close all contexts and browsers)
    try {
      const pool = (app as unknown as Record<string, unknown>)['browserPool'];
      if (pool && typeof (pool as { destroy: () => Promise<void> }).destroy === 'function') {
        await (pool as { destroy: () => Promise<void> }).destroy();
        logger.info('Browser pool drained');
      }
    } catch (error) {
      logger.error({ err: error }, 'Error draining browser pool');
    }

    // 5. Close Redis connection
    try {
      const { closeRedis } = await import('./queue/redis.js');
      await closeRedis();
      logger.info('Redis connection closed');
    } catch (error) {
      logger.error({ err: error }, 'Error closing Redis');
    }

    // 6. Close database connection
    try {
      const { closeDb } = await import('./db/index.js');
      closeDb();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error({ err: error }, 'Error closing database');
    }

    clearTimeout(forceKillTimer);
    logger.info('Graceful shutdown complete');
    process.exit(0);
  };

  // Expose the shutdown function so index.ts can call it from global error handlers
  (app as unknown as Record<string, unknown>)['gracefulShutdown'] = gracefulShutdown;

  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

  return app;
}
