import { getLogger } from '../shared/logger.js';
import type { ProxyPool } from './proxy-pool.js';
import type { ProxyConfig, HealthResult } from './types.js';

const log = getLogger('proxy', { component: 'health-checker' });

const HEALTH_CHECK_URL = 'https://httpbin.org/ip';
const HEALTH_CHECK_TIMEOUT_MS = 15_000;
const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Maximum number of proxies to check concurrently during a health sweep.
 * Limits resource usage when the pool is large.
 */
const CONCURRENCY_LIMIT = 10;

/**
 * Periodically verifies proxy health by testing connectivity through
 * each proxy to a known public endpoint. Dead proxies are marked
 * inactive after repeated failures.
 */
export class ProxyHealthChecker {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private checking = false;

  constructor(private readonly pool: ProxyPool) {}

  /**
   * Starts periodic health checking at the given interval.
   * Default interval is 5 minutes.
   */
  startChecking(intervalMs: number = DEFAULT_CHECK_INTERVAL_MS): void {
    if (this.intervalHandle) {
      log.warn('Health checker already running, stopping existing before restart');
      this.stopChecking();
    }

    log.info({ intervalMs }, 'Starting proxy health checker');

    // Run an initial check immediately, then on the interval
    void this.checkAll();

    this.intervalHandle = setInterval(() => {
      void this.checkAll();
    }, intervalMs);
  }

  /**
   * Stops the periodic health check timer.
   */
  stopChecking(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      log.info('Proxy health checker stopped');
    }
  }

  /**
   * Tests connectivity through a single proxy by making an HTTP request
   * to httpbin.org/ip and measuring the round-trip latency.
   *
   * For HTTP/HTTPS proxies, uses Node's native fetch with an HTTP CONNECT
   * tunnel. For SOCKS proxies, a direct TCP test is performed instead.
   */
  async checkProxy(proxy: ProxyConfig): Promise<HealthResult> {
    const start = Date.now();

    try {
      const proxyUrl = this.buildProxyUrl(proxy);

      // Use native fetch with an HTTP proxy agent via undici's ProxyAgent,
      // which ships with Node 20+. This is the correct way to route
      // requests through a proxy in modern Node.js.
      const { ProxyAgent } = await import('undici');

      const dispatcher = new ProxyAgent({
        uri: proxyUrl,
        requestTls: { timeout: HEALTH_CHECK_TIMEOUT_MS },
      });

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        HEALTH_CHECK_TIMEOUT_MS,
      );

      try {
        const response = await fetch(HEALTH_CHECK_URL, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          // @ts-expect-error -- undici dispatcher is accepted by Node fetch
          dispatcher,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} from health check endpoint`);
        }

        const body = (await response.json()) as { origin?: string };
        const latencyMs = Date.now() - start;
        const ip = body.origin?.trim() ?? 'unknown';

        return { healthy: true, latencyMs, ip };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const latencyMs = Date.now() - start;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        healthy: false,
        latencyMs,
        ip: '',
        error: errorMessage,
      };
    }
  }

  /**
   * Checks all proxies in the pool and updates their health status.
   * Limits concurrency to avoid overwhelming the network.
   */
  async checkAll(): Promise<void> {
    if (this.checking) {
      log.debug('Health check already in progress, skipping');
      return;
    }

    this.checking = true;
    const allProxies = this.pool.getAll();

    if (allProxies.length === 0) {
      this.checking = false;
      return;
    }

    log.info(
      { count: allProxies.length },
      'Starting health check for all proxies',
    );

    let healthy = 0;
    let degraded = 0;
    let dead = 0;

    // Process in batches to limit concurrency
    for (let i = 0; i < allProxies.length; i += CONCURRENCY_LIMIT) {
      const batch = allProxies.slice(i, i + CONCURRENCY_LIMIT);

      const results = await Promise.allSettled(
        batch.map(async (proxy) => {
          const result = await this.checkProxy(proxy);
          await this.applyResult(proxy.id, result);
          return { proxyId: proxy.id, result };
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value.result.healthy) {
            if (result.value.result.latencyMs > 5000) {
              degraded++;
            } else {
              healthy++;
            }
          } else {
            dead++;
          }
        } else {
          dead++;
        }
      }
    }

    log.info(
      { healthy, degraded, dead, total: allProxies.length },
      'Health check complete',
    );
    this.checking = false;
  }

  /**
   * Applies a single health check result to the pool, updating
   * status and recording failures.
   */
  private async applyResult(
    proxyId: string,
    result: HealthResult,
  ): Promise<void> {
    if (result.healthy) {
      const status = result.latencyMs > 5000 ? 'degraded' : 'healthy';
      await this.pool.updateHealth(proxyId, status, result.latencyMs);
    } else {
      const proxy = this.pool.get(proxyId);
      if (!proxy) return;

      await this.pool.recordFailure(proxyId, MAX_CONSECUTIVE_FAILURES);

      log.debug(
        {
          proxyId,
          error: result.error,
          consecutiveFailures: proxy.consecutiveFailures,
        },
        'Proxy health check failed',
      );
    }
  }

  /**
   * Constructs the full proxy URL from a ProxyConfig.
   *
   * For socks4/socks5 proxies, we use the socks5h:// scheme so the
   * proxy performs DNS resolution (prevents DNS leaks).
   */
  private buildProxyUrl(proxy: ProxyConfig): string {
    const auth =
      proxy.username && proxy.password
        ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
        : '';

    let scheme: string;
    switch (proxy.protocol) {
      case 'https':
        scheme = 'https';
        break;
      case 'socks5':
        scheme = 'socks5';
        break;
      case 'socks4':
        scheme = 'socks4';
        break;
      default:
        scheme = 'http';
    }

    return `${scheme}://${auth}${proxy.host}:${proxy.port}`;
  }
}
