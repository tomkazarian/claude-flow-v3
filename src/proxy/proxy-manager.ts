import { getLogger } from '../shared/logger.js';
import { ProxyError } from '../shared/errors.js';
import { generateId } from '../shared/crypto.js';
import { eventBus } from '../shared/events.js';
import { ProxyPool } from './proxy-pool.js';
import { ProxyHealthChecker } from './proxy-health-checker.js';
import { ProxyRotator } from './proxy-rotator.js';
import type {
  ProxyConfig,
  ProxyInput,
  ProxyRequestOptions,
  ProxyStats,
  RotationStrategy,
} from './types.js';

const log = getLogger('proxy', { component: 'manager' });

export interface ProxyManagerConfig {
  healthCheckIntervalMs?: number;
  defaultRotationStrategy?: RotationStrategy;
  maxConsecutiveFailures?: number;
}

/**
 * Main orchestrator for proxy lifecycle: fetching, rotation, health checking,
 * and statistics. This is the primary entry point for other modules to
 * obtain and release proxies.
 */
export class ProxyManager {
  private readonly pool: ProxyPool;
  private readonly healthChecker: ProxyHealthChecker;
  private readonly rotator: ProxyRotator;
  private readonly config: Required<ProxyManagerConfig>;
  private initialized = false;

  constructor(config: ProxyManagerConfig = {}) {
    this.config = {
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 5 * 60 * 1000,
      defaultRotationStrategy: config.defaultRotationStrategy ?? 'weighted',
      maxConsecutiveFailures: config.maxConsecutiveFailures ?? 3,
    };

    this.pool = new ProxyPool();
    this.healthChecker = new ProxyHealthChecker(this.pool);
    this.rotator = new ProxyRotator(this.pool);
  }

  /**
   * Initializes the proxy manager: loads proxies from the provided
   * source and starts the health checker.
   */
  async initialize(initialProxies?: ProxyInput[]): Promise<void> {
    if (this.initialized) {
      log.warn('ProxyManager already initialized');
      return;
    }

    log.info('Initializing ProxyManager');

    if (initialProxies && initialProxies.length > 0) {
      await Promise.all(initialProxies.map((input) => this.addProxy(input)));
      log.info({ count: initialProxies.length }, 'Loaded initial proxies');
    }

    this.healthChecker.startChecking(this.config.healthCheckIntervalMs);
    this.initialized = true;

    log.info(
      { poolSize: this.pool.size, healthCheckIntervalMs: this.config.healthCheckIntervalMs },
      'ProxyManager initialized',
    );
  }

  /**
   * Shuts down the proxy manager: stops health checking and clears the pool.
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down ProxyManager');
    this.healthChecker.stopChecking();
    await this.pool.clear();
    this.initialized = false;
  }

  /**
   * Gets a proxy from the pool using the configured rotation strategy.
   * The proxy is marked as in-use and must be released after use.
   */
  async getProxy(options?: ProxyRequestOptions): Promise<ProxyConfig> {
    this.ensureInitialized();

    const filter = options
      ? {
          country: options.country,
          state: options.state,
          type: options.type,
          excludeIds: options.excludeIds ? new Set(options.excludeIds) : undefined,
        }
      : undefined;

    try {
      const proxy = this.rotator.getNext(
        this.config.defaultRotationStrategy,
        filter,
        options?.domain,
      );

      await this.pool.markUsed(proxy.id);

      log.debug(
        {
          proxyId: proxy.id,
          host: proxy.host,
          country: proxy.country,
          state: proxy.state,
        },
        'Proxy assigned',
      );

      return proxy;
    } catch (error) {
      if (error instanceof ProxyError) throw error;
      throw new ProxyError(
        'Failed to get proxy from pool',
        'PROXY_ASSIGNMENT_FAILED',
        '',
      );
    }
  }

  /**
   * Releases a proxy back to the pool and records success/failure.
   */
  async releaseProxy(proxyId: string, success: boolean): Promise<void> {
    await this.pool.markFree(proxyId);

    if (success) {
      await this.pool.recordSuccess(proxyId);
    } else {
      await this.pool.recordFailure(proxyId, this.config.maxConsecutiveFailures);

      const proxy = this.pool.get(proxyId);
      if (proxy) {
        eventBus.emit('proxy:failed', {
          proxy: `${proxy.host}:${proxy.port}`,
          error: 'Request failed through proxy',
        });
      }
    }

    log.debug({ proxyId, success }, 'Proxy released');
  }

  /**
   * Gets a different proxy than the one currently in use.
   * The old proxy is released (marked as failure) and a new one is selected.
   */
  async rotateProxy(
    currentProxyId: string,
    options?: ProxyRequestOptions,
  ): Promise<ProxyConfig> {
    this.ensureInitialized();

    const oldProxy = this.pool.get(currentProxyId);

    // Release the old proxy as failed
    await this.releaseProxy(currentProxyId, false);

    // Exclude the old proxy from the next selection
    const excludeIds = new Set<string>([
      currentProxyId,
      ...(options?.excludeIds ?? []),
    ]);

    const filter = {
      country: options?.country,
      state: options?.state,
      type: options?.type,
      excludeIds,
    };

    const newProxy = this.rotator.getNext(
      this.config.defaultRotationStrategy,
      filter,
      options?.domain,
    );

    await this.pool.markUsed(newProxy.id);

    eventBus.emit('proxy:rotated', {
      oldProxy: oldProxy ? `${oldProxy.host}:${oldProxy.port}` : currentProxyId,
      newProxy: `${newProxy.host}:${newProxy.port}`,
    });

    log.info(
      { oldProxyId: currentProxyId, newProxyId: newProxy.id },
      'Proxy rotated',
    );

    return newProxy;
  }

  /**
   * Adds a new proxy to the pool.
   */
  async addProxy(input: ProxyInput): Promise<string> {
    const proxyConfig: ProxyConfig = {
      id: generateId(),
      host: input.host,
      port: input.port,
      protocol: input.protocol ?? 'http',
      username: input.username,
      password: input.password,
      type: input.type ?? 'datacenter',
      country: input.country,
      state: input.state,
      city: input.city,
      provider: input.provider ?? 'static',
      healthStatus: 'unknown',
      latencyMs: 0,
      successCount: 0,
      failureCount: 0,
      lastUsedAt: 0,
      lastCheckedAt: 0,
      consecutiveFailures: 0,
      inUse: false,
      createdAt: Date.now(),
    };

    await this.pool.add(proxyConfig);
    log.debug({ proxyId: proxyConfig.id, host: input.host }, 'Proxy added');
    return proxyConfig.id;
  }

  /**
   * Removes a proxy from the pool.
   */
  async removeProxy(proxyId: string): Promise<void> {
    const removed = await this.pool.remove(proxyId);
    if (!removed) {
      throw new ProxyError(
        `Proxy not found: ${proxyId}`,
        'PROXY_NOT_FOUND',
        proxyId,
      );
    }
    log.info({ proxyId }, 'Proxy removed');
  }

  /**
   * Returns aggregate statistics about the proxy pool.
   */
  getStats(): ProxyStats {
    const all = this.pool.getAll();

    let healthy = 0;
    let degraded = 0;
    let dead = 0;
    let inUse = 0;
    let totalLatency = 0;
    let totalSuccess = 0;
    let totalFailure = 0;
    let latencyCount = 0;

    for (const proxy of all) {
      switch (proxy.healthStatus) {
        case 'healthy':
          healthy++;
          break;
        case 'degraded':
          degraded++;
          break;
        case 'dead':
          dead++;
          break;
        // 'unknown' is not counted in any health bucket
      }

      if (proxy.inUse) inUse++;

      if (proxy.latencyMs > 0) {
        totalLatency += proxy.latencyMs;
        latencyCount++;
      }

      totalSuccess += proxy.successCount;
      totalFailure += proxy.failureCount;
    }

    const total = all.length;
    const active = total - dead;
    const avgLatencyMs = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;
    const totalRequests = totalSuccess + totalFailure;
    const successRate = totalRequests > 0 ? totalSuccess / totalRequests : 0;

    return {
      total,
      active,
      healthy,
      degraded,
      dead,
      inUse,
      avgLatencyMs,
      successRate,
    };
  }

  /**
   * Returns the underlying pool for direct access when needed (e.g., providers).
   */
  getPool(): ProxyPool {
    return this.pool;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ProxyError(
        'ProxyManager not initialized. Call initialize() first.',
        'PROXY_NOT_INITIALIZED',
        '',
      );
    }
  }
}
