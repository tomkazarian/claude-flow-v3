/**
 * Periodic health check scheduler.
 *
 * Monitors system health at regular intervals:
 * - Every 5 minutes: proxy health checks
 * - Every 1 minute:  queue depth monitoring (alert if backing up)
 * - Every 1 hour:    CAPTCHA provider balance check
 */

import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import { getLogger } from '../../shared/logger.js';
import { getDb, schema } from '../../db/index.js';
import type { QueueManager } from '../queue-manager.js';

const log = getLogger('queue', { component: 'health-check-scheduler' });

type CronTask = ReturnType<typeof cron.schedule>;

/** Threshold above which a queue is considered "backing up". */
const QUEUE_DEPTH_ALERT_THRESHOLD = 100;
/** Threshold below which a CAPTCHA balance is considered "low". */
const CAPTCHA_BALANCE_LOW_THRESHOLD = 5.0; // dollars

export class HealthCheckScheduler {
  private readonly queueManager: QueueManager;
  private cronJobs: CronTask[] = [];
  private running = false;

  constructor(queueManager: QueueManager) {
    this.queueManager = queueManager;
  }

  /**
   * Starts all health check cron jobs.
   */
  start(): void {
    if (this.running) {
      log.warn('HealthCheckScheduler already running');
      return;
    }

    // Every 5 minutes: check proxy health
    const proxyCron = cron.schedule('*/5 * * * *', () => {
      this.checkProxyHealth().catch((err) => {
        log.error({ err }, 'Proxy health check failed');
      });
    });
    this.cronJobs.push(proxyCron);

    // Every 1 minute: check queue depths
    const queueCron = cron.schedule('* * * * *', () => {
      this.checkQueueDepths().catch((err) => {
        log.error({ err }, 'Queue depth check failed');
      });
    });
    this.cronJobs.push(queueCron);

    // Every hour: check CAPTCHA provider balance
    const captchaCron = cron.schedule('0 * * * *', () => {
      this.checkCaptchaBalance().catch((err) => {
        log.error({ err }, 'CAPTCHA balance check failed');
      });
    });
    this.cronJobs.push(captchaCron);

    this.running = true;
    log.info('HealthCheckScheduler started');
  }

  /**
   * Stops all health check cron jobs.
   */
  stop(): void {
    for (const job of this.cronJobs) {
      job.stop();
    }
    this.cronJobs = [];
    this.running = false;
    log.info('HealthCheckScheduler stopped');
  }

  // -------------------------------------------------------------------------
  // Health checks
  // -------------------------------------------------------------------------

  /**
   * Checks the health of all active proxies and updates their status.
   */
  private async checkProxyHealth(): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();

    // Get all active proxies
    const activeProxies = await db
      .select()
      .from(schema.proxies)
      .where(eq(schema.proxies.isActive, 1));

    if (activeProxies.length === 0) {
      log.debug('No active proxies to check');
      return;
    }

    let healthyCount = 0;
    let degradedCount = 0;
    let deadCount = 0;

    for (const proxy of activeProxies) {
      const isHealthy = await testProxyConnectivity(proxy.host, proxy.port);

      let newStatus: 'healthy' | 'degraded' | 'dead';
      if (isHealthy) {
        healthyCount += 1;
        newStatus = 'healthy';
      } else if (proxy.healthStatus === 'healthy') {
        // First failure after being healthy -> degraded
        degradedCount += 1;
        newStatus = 'degraded';
      } else {
        // Already degraded and still failing -> dead
        deadCount += 1;
        newStatus = 'dead';
      }

      await db
        .update(schema.proxies)
        .set({
          healthStatus: newStatus,
          lastHealthCheck: now,
        })
        .where(eq(schema.proxies.id, proxy.id));
    }

    log.info(
      {
        total: activeProxies.length,
        healthy: healthyCount,
        degraded: degradedCount,
        dead: deadCount,
      },
      'Proxy health check completed',
    );

    // Warn if too many proxies are unhealthy
    const unhealthyPercent =
      ((degradedCount + deadCount) / activeProxies.length) * 100;
    if (unhealthyPercent > 50) {
      log.warn(
        { unhealthyPercent: Math.round(unhealthyPercent) },
        'More than 50% of proxies are unhealthy',
      );
    }
  }

  /**
   * Checks queue depths and logs warnings if any queue is backing up.
   */
  private async checkQueueDepths(): Promise<void> {
    const allStatus = await this.queueManager.getAllQueuesStatus();
    const alerts: Array<{ queue: string; waiting: number; active: number }> = [];

    for (const [queueName, status] of Object.entries(allStatus)) {
      const totalPending = status.waiting + status.delayed;

      if (totalPending > QUEUE_DEPTH_ALERT_THRESHOLD) {
        alerts.push({
          queue: queueName,
          waiting: status.waiting,
          active: status.active,
        });
      }

      // Log a warning if the failed count is growing
      if (status.failed > 50) {
        log.warn(
          {
            queue: queueName,
            failedCount: status.failed,
          },
          'High failure count in queue',
        );
      }
    }

    if (alerts.length > 0) {
      log.warn(
        { alerts },
        'Queue depth alert: one or more queues are backing up',
      );
    } else {
      log.debug({ queueStatus: allStatus }, 'Queue depths nominal');
    }
  }

  /**
   * Checks the balance of configured CAPTCHA providers.
   * Logs a warning if any provider balance is below the threshold.
   */
  private async checkCaptchaBalance(): Promise<void> {
    const balances: Array<{ provider: string; balance: number }> = [];

    // Check 2captcha balance
    const twoCaptchaKey = process.env['TWOCAPTCHA_API_KEY'];
    if (twoCaptchaKey) {
      const balance = await check2CaptchaBalance(twoCaptchaKey);
      if (balance !== null) {
        balances.push({ provider: '2captcha', balance });
      }
    }

    // Check anti-captcha balance
    const antiCaptchaKey = process.env['ANTICAPTCHA_API_KEY'];
    if (antiCaptchaKey) {
      const balance = await checkAntiCaptchaBalance(antiCaptchaKey);
      if (balance !== null) {
        balances.push({ provider: 'anticaptcha', balance });
      }
    }

    // Check capsolver balance
    const capsolverKey = process.env['CAPSOLVER_API_KEY'];
    if (capsolverKey) {
      const balance = await checkCapsolverBalance(capsolverKey);
      if (balance !== null) {
        balances.push({ provider: 'capsolver', balance });
      }
    }

    if (balances.length === 0) {
      log.debug('No CAPTCHA providers configured, skipping balance check');
      return;
    }

    for (const { provider, balance } of balances) {
      if (balance < CAPTCHA_BALANCE_LOW_THRESHOLD) {
        log.warn(
          { provider, balance, threshold: CAPTCHA_BALANCE_LOW_THRESHOLD },
          'CAPTCHA provider balance is low',
        );
      } else {
        log.info({ provider, balance }, 'CAPTCHA provider balance OK');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// External connectivity helpers
// ---------------------------------------------------------------------------

/**
 * Tests basic TCP connectivity to a proxy server.
 */
async function testProxyConnectivity(
  host: string,
  port: number,
): Promise<boolean> {
  const { createConnection } = await import('node:net');

  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port, timeout: 5_000 }, () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Checks 2captcha account balance.
 */
async function check2CaptchaBalance(apiKey: string): Promise<number | null> {
  try {
    const { default: got } = await import('got');
    const response = await got(
      `https://2captcha.com/res.php?key=${apiKey}&action=getbalance&json=1`,
      {
        timeout: { request: 10_000 },
        responseType: 'json',
      },
    );
    const data = response.body as { status: number; request: string };
    if (data.status === 1) {
      return parseFloat(data.request);
    }
    return null;
  } catch (error) {
    log.warn({ err: error }, 'Failed to check 2captcha balance');
    return null;
  }
}

/**
 * Checks anti-captcha account balance.
 */
async function checkAntiCaptchaBalance(apiKey: string): Promise<number | null> {
  try {
    const { default: got } = await import('got');
    const response = await got.post(
      'https://api.anti-captcha.com/getBalance',
      {
        json: { clientKey: apiKey },
        timeout: { request: 10_000 },
        responseType: 'json',
      },
    );
    const data = response.body as { errorId: number; balance: number };
    if (data.errorId === 0) {
      return data.balance;
    }
    return null;
  } catch (error) {
    log.warn({ err: error }, 'Failed to check anti-captcha balance');
    return null;
  }
}

/**
 * Checks capsolver account balance.
 */
async function checkCapsolverBalance(apiKey: string): Promise<number | null> {
  try {
    const { default: got } = await import('got');
    const response = await got.post(
      'https://api.capsolver.com/getBalance',
      {
        json: { clientKey: apiKey },
        timeout: { request: 10_000 },
        responseType: 'json',
      },
    );
    const data = response.body as { errorId: number; balance: number };
    if (data.errorId === 0) {
      return data.balance;
    }
    return null;
  } catch (error) {
    log.warn({ err: error }, 'Failed to check capsolver balance');
    return null;
  }
}
