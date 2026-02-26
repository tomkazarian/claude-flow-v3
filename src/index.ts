/**
 * Application entry point for the Sweepstakes Platform.
 *
 * Initializes all subsystems in order:
 * 1. Environment validation
 * 2. Database (run migrations)
 * 3. Redis connection
 * 4. Server creation and startup
 *
 * Handles uncaught exceptions and unhandled rejections gracefully.
 */

import { config } from 'dotenv';
import { getLogger } from './shared/logger.js';

// Load .env before anything else
config();

const logger = getLogger('server');

async function main(): Promise<void> {
  logger.info('Starting Sweepstakes Platform...');

  // ---------------------------------------------------------------------------
  // 1. Validate environment
  // ---------------------------------------------------------------------------
  let env: Awaited<typeof import('./env.js')>['env'];
  try {
    const envModule = await import('./env.js');
    env = envModule.env;
    logger.info({ nodeEnv: env.NODE_ENV }, 'Environment validated');
  } catch (error) {
    logger.fatal({ err: error }, 'Environment validation failed');
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 2. Initialize database (run migrations)
  // ---------------------------------------------------------------------------
  try {
    const { migrate } = await import('./db/migrate.js');
    migrate(env.DATABASE_PATH);
    logger.info('Database migrations applied');
  } catch (error) {
    logger.fatal({ err: error }, 'Database initialization failed');
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // 3. Initialize Redis connection
  // ---------------------------------------------------------------------------
  try {
    const { getRedis } = await import('./queue/redis.js');
    const redis = getRedis();
    if (redis) {
      logger.info('Redis connection initialized');
    } else {
      logger.warn('Redis not configured; queue features will be unavailable');
    }
  } catch (error) {
    logger.warn({ err: error }, 'Redis initialization failed; continuing without queues');
  }

  // ---------------------------------------------------------------------------
  // 4. Initialize QueueManager (creates workers that process jobs)
  // ---------------------------------------------------------------------------
  try {
    const { QueueManager } = await import('./queue/queue-manager.js');
    const qm = new QueueManager();
    await qm.initialize(env.REDIS_URL);
    // Store globally so the server shutdown handler can access it
    (globalThis as Record<string, unknown>)['__queueManager'] = qm;

    if (qm.isFallbackMode) {
      logger.warn('QueueManager running in FALLBACK mode (no Redis). Jobs stored in-memory.');
    } else {
      logger.info('QueueManager initialized with Redis and workers');
    }
  } catch (error) {
    logger.warn({ err: error }, 'QueueManager initialization failed; jobs will not be processed');
  }

  // ---------------------------------------------------------------------------
  // 4b. Start schedulers (discovery, recurring entries, health checks)
  // ---------------------------------------------------------------------------
  const schedulerInstances: Array<{ stop: () => void }> = [];
  try {
    const qm = (globalThis as Record<string, unknown>)['__queueManager'] as
      | import('./queue/queue-manager.js').QueueManager
      | undefined;

    if (qm && !qm.isFallbackMode) {
      const { DiscoveryScheduler } = await import('./queue/schedulers/discovery-scheduler.js');
      const { RecurringEntryScheduler } = await import('./queue/schedulers/recurring-entry-scheduler.js');
      const { HealthCheckScheduler } = await import('./queue/schedulers/health-check-scheduler.js');

      const discoveryScheduler = new DiscoveryScheduler(qm);
      discoveryScheduler.start();
      schedulerInstances.push(discoveryScheduler);

      const entryScheduler = new RecurringEntryScheduler(qm, {
        maxEntriesPerHour: env.MAX_ENTRIES_PER_HOUR,
      });
      entryScheduler.start();
      schedulerInstances.push(entryScheduler);

      const healthScheduler = new HealthCheckScheduler(qm);
      healthScheduler.start();
      schedulerInstances.push(healthScheduler);

      logger.info(
        { schedulerCount: schedulerInstances.length },
        'All schedulers started (discovery, recurring-entry, health-check)',
      );
    } else {
      logger.warn('Schedulers not started: QueueManager not available or in fallback mode');
    }
  } catch (error) {
    logger.warn({ err: error }, 'Failed to start one or more schedulers');
  }

  // Store schedulers globally so the server shutdown handler can stop them
  (globalThis as Record<string, unknown>)['__schedulers'] = schedulerInstances;

  // ---------------------------------------------------------------------------
  // 5. Create and start the Fastify server
  // ---------------------------------------------------------------------------
  try {
    const { createServer } = await import('./server.js');
    const app = await createServer();

    // Attach the QueueManager to the app for graceful shutdown
    const qm = (globalThis as Record<string, unknown>)['__queueManager'];
    if (qm) {
      (app as unknown as Record<string, unknown>)['queueManager'] = qm;
    }

    // Attach schedulers to the app for graceful shutdown
    (app as unknown as Record<string, unknown>)['schedulers'] = schedulerInstances;

    // Initialize the status bridge to forward eventBus events to the status monitor
    const { initStatusBridge } = await import('./analytics/status-bridge.js');
    initStatusBridge();

    // Capture the graceful shutdown function for global error handlers
    const shutdownFn = (app as unknown as Record<string, unknown>)['gracefulShutdown'];
    if (typeof shutdownFn === 'function') {
      appShutdown = shutdownFn as (reason: string) => Promise<void>;
    }

    const host = '0.0.0.0';
    const port = env.PORT;

    await app.listen({ host, port });

    logger.info(
      {
        port,
        environment: env.NODE_ENV,
        headless: env.BROWSER_HEADLESS,
        maxBrowsers: env.MAX_BROWSER_INSTANCES,
        maxEntriesPerHour: env.MAX_ENTRIES_PER_HOUR,
        maxEntriesPerDay: env.MAX_ENTRIES_PER_DAY,
      },
      `Sweepstakes Platform started on http://${host}:${port}`,
    );

    logger.info('Active features:');
    logger.info(`  - API: http://${host}:${port}/api/v1/health`);
    logger.info(`  - Database: ${env.DATABASE_PATH}`);
    logger.info(`  - Redis: ${env.REDIS_URL}`);
    if (env.TWOCAPTCHA_API_KEY) logger.info('  - 2Captcha: configured');
    if (env.ANTICAPTCHA_API_KEY) logger.info('  - AntiCaptcha: configured');
    if (env.CAPSOLVER_API_KEY) logger.info('  - CapSolver: configured');
    if (env.TWILIO_ACCOUNT_SID) logger.info('  - Twilio SMS: configured');
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Global error handlers
// ---------------------------------------------------------------------------

// Reference to the app's graceful shutdown function, set after server creation
let appShutdown: ((reason: string) => Promise<void>) | undefined;

process.on('uncaughtException', (error: Error) => {
  logger.fatal({ err: error }, 'Uncaught exception - initiating graceful shutdown');
  if (appShutdown) {
    void appShutdown('uncaughtException');
  } else {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ err: reason }, 'Unhandled rejection - initiating graceful shutdown');
  if (appShutdown) {
    void appShutdown('unhandledRejection');
  } else {
    process.exit(1);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
void main().then(() => {
  // After the server starts, capture the graceful shutdown reference.
  // The shutdown function is attached to the app instance by createServer.
  // Since main() uses dynamic imports, we re-import to access the app.
}).catch(() => {
  // main() handles its own errors
});
