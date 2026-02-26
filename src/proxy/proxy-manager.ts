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

/**
 * Sentinel ID for the "direct connection" pseudo-proxy.
 * When the pool is empty or all proxies are exhausted, this synthetic
 * proxy config signals that the caller should make a direct connection
 * instead of tunnelling through a proxy.
 */
const DIRECT_PROXY_ID = '__direct__';

export interface ProxyManagerConfig {
  healthCheckIntervalMs?: number;
  defaultRotationStrategy?: RotationStrategy;
  maxConsecutiveFailures?: number;
  /** If true, return a direct-connection proxy when the pool is empty
   *  instead of throwing PROXY_POOL_EXHAUSTED. Default: true. */
  allowDirectFallback?: boolean;
}

/**
 * Main orchestrator for proxy lifecycle: fetching, rotation, health checking,
 * and statistics. This is the primary entry point for other modules to
 * obtain and release proxies.
 *
 * When no proxies are configured, the manager returns a sentinel "direct"
 * proxy config so callers can proceed without a proxy (unless
 * `allowDirectFallback` is set to false).
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
      allowDirectFallback: config.allowDirectFallback ?? true,
    };

    this.pool = new ProxyPool();
    this.healthChecker = new ProxyHealthChecker(this.pool);
    this.rotator = new ProxyRotator(this.pool);
  }

  /**
   * Initializes the proxy manager: loads proxies from the provided
   * source and starts the health checker.
   *
   * If no proxies are supplied, the manager still initializes
   * successfully. Calls to `getProxy()` will return a direct-connection
   * sentinel (unless `allowDirectFallback` is false).
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
    } else {
      log.info(
        'No initial proxies supplied. Requests will use direct connections unless proxies are added later.',
      );
    }

    // Only start health checking if there are proxies to check
    if (this.pool.size > 0) {
      this.healthChecker.startChecking(this.config.healthCheckIntervalMs);
    }

    this.initialized = true;

    log.info(
      {
        poolSize: this.pool.size,
        healthCheckIntervalMs: this.config.healthCheckIntervalMs,
        directFallback: this.config.allowDirectFallback,
      },
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
   *
   * If the pool is empty and `allowDirectFallback` is true, returns
   * a sentinel ProxyConfig with `id === '__direct__'` indicating that
   * the caller should make a direct connection.
   */
  async getProxy(options?: ProxyRequestOptions): Promise<ProxyConfig> {
    this.ensureInitialized();

    // Fast path: no proxies in the pool at all
    if (this.pool.size === 0) {
      return this.handleEmptyPool(options);
    }

    const filter = options
      ? {
          country: options.country,
          state: options.state,
          type: options.type,
          excludeIds: options.excludeIds
            ? new Set(options.excludeIds)
            : undefined,
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
      // If pool exhausted but direct fallback allowed, use direct
      if (
        error instanceof ProxyError &&
        error.code === 'PROXY_POOL_EXHAUSTED' &&
        this.config.allowDirectFallback
      ) {
        log.warn(
          'Proxy pool exhausted, falling back to direct connection',
        );
        return this.buildDirectProxy();
      }

      if (error instanceof ProxyError) throw error;
      throw new ProxyError(
        'Failed to get proxy from pool',
        'PROXY_ASSIGNMENT_FAILED',
        '',
      );
    }
  }

  /**
   * Returns true if the given proxy config represents a direct connection
   * (no proxy). Callers should check this before configuring a proxy agent.
   */
  static isDirect(proxy: ProxyConfig): boolean {
    return proxy.id === DIRECT_PROXY_ID;
  }

  /**
   * Releases a proxy back to the pool and records success/failure.
   * No-op for the direct-connection sentinel.
   */
  async releaseProxy(proxyId: string, success: boolean): Promise<void> {
    if (proxyId === DIRECT_PROXY_ID) return;

    await this.pool.markFree(proxyId);

    if (success) {
      await this.pool.recordSuccess(proxyId);
    } else {
      await this.pool.recordFailure(
        proxyId,
        this.config.maxConsecutiveFailures,
      );

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

    try {
      const newProxy = this.rotator.getNext(
        this.config.defaultRotationStrategy,
        filter,
        options?.domain,
      );

      await this.pool.markUsed(newProxy.id);

      eventBus.emit('proxy:rotated', {
        oldProxy: oldProxy
          ? `${oldProxy.host}:${oldProxy.port}`
          : currentProxyId,
        newProxy: `${newProxy.host}:${newProxy.port}`,
      });

      log.info(
        { oldProxyId: currentProxyId, newProxyId: newProxy.id },
        'Proxy rotated',
      );

      return newProxy;
    } catch (error) {
      if (
        error instanceof ProxyError &&
        error.code === 'PROXY_POOL_EXHAUSTED' &&
        this.config.allowDirectFallback
      ) {
        log.warn(
          'All proxies exhausted during rotation, falling back to direct',
        );
        return this.buildDirectProxy();
      }
      throw error;
    }
  }

  /**
   * Adds a new proxy to the pool. If the health checker is not running
   * (because the pool was previously empty), starts it now.
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

    const wasEmpty = this.pool.size === 0;
    await this.pool.add(proxyConfig);

    // Start health checker if this is the first proxy added after init
    if (wasEmpty && this.initialized) {
      this.healthChecker.startChecking(this.config.healthCheckIntervalMs);
    }

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

    // Stop health checker if pool is now empty
    if (this.pool.size === 0) {
      this.healthChecker.stopChecking();
    }
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
    const avgLatencyMs =
      latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;
    const totalRequests = totalSuccess + totalFailure;
    const successRate =
      totalRequests > 0 ? totalSuccess / totalRequests : 0;

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

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ProxyError(
        'ProxyManager not initialized. Call initialize() first.',
        'PROXY_NOT_INITIALIZED',
        '',
      );
    }
  }

  /**
   * Handles the case where the pool is empty when `getProxy` is called.
   */
  private handleEmptyPool(_options?: ProxyRequestOptions): ProxyConfig {
    if (this.config.allowDirectFallback) {
      log.debug(
        'No proxies in pool, returning direct connection sentinel',
      );
      return this.buildDirectProxy();
    }
    throw new ProxyError(
      'No proxies available and direct fallback is disabled',
      'PROXY_POOL_EXHAUSTED',
      '',
    );
  }

  /**
   * Builds a sentinel ProxyConfig that represents a direct connection.
   * Callers should check `ProxyManager.isDirect(proxy)` before
   * attempting to configure a proxy agent.
   */
  private buildDirectProxy(): ProxyConfig {
    return {
      id: DIRECT_PROXY_ID,
      host: 'localhost',
      port: 0,
      protocol: 'http',
      type: 'datacenter',
      provider: 'direct',
      healthStatus: 'healthy',
      latencyMs: 0,
      successCount: 0,
      failureCount: 0,
      lastUsedAt: 0,
      lastCheckedAt: Date.now(),
      consecutiveFailures: 0,
      inUse: false,
      createdAt: Date.now(),
    };
  }
}
