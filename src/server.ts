import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
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
      ? (process.env['CORS_ORIGIN'] ?? true)
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

    try {
      // Close the HTTP server (stop accepting new connections)
      await app.close();
      logger.info('Fastify server closed');
    } catch (error) {
      logger.error({ err: error }, 'Error during Fastify server close');
    }

    try {
      // Close Redis
      const { closeRedis } = await import('./queue/redis.js');
      await closeRedis();
    } catch (error) {
      logger.error({ err: error }, 'Error closing Redis');
    }

    try {
      // Close database
      const { closeDb } = await import('./db/index.js');
      closeDb();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error({ err: error }, 'Error closing database');
    }

    logger.info('Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return app;
}
