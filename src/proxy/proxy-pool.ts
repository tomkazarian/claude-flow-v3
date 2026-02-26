import { getLogger } from '../shared/logger.js';
import { ProxyError } from '../shared/errors.js';
import type {
  ProxyConfig,
  ProxyFilter,
  HealthStatus,
} from './types.js';

const log = getLogger('proxy', { component: 'pool' });

/**
 * In-memory pool of proxy configurations with filtering,
 * health tracking, and a simple mutex for thread safety.
 */
export class ProxyPool {
  private readonly proxies = new Map<string, ProxyConfig>();
  private locked = false;
  private waitQueue: Array<() => void> = [];

  /**
   * Acquires the pool lock. If already locked, waits for release.
   */
  private async acquireLock(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.locked = true;
        resolve();
      });
    });
  }

  /**
   * Releases the pool lock, allowing the next waiting caller through.
   */
  private releaseLock(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  get size(): number {
    return this.proxies.size;
  }

  /**
   * Adds or replaces a proxy in the pool.
   */
  async add(proxy: ProxyConfig): Promise<void> {
    await this.acquireLock();
    try {
      this.proxies.set(proxy.id, proxy);
      log.debug({ proxyId: proxy.id, host: proxy.host }, 'Proxy added to pool');
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Removes a proxy from the pool.
   */
  async remove(id: string): Promise<boolean> {
    await this.acquireLock();
    try {
      const removed = this.proxies.delete(id);
      if (removed) {
        log.debug({ proxyId: id }, 'Proxy removed from pool');
      }
      return removed;
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Returns a proxy by ID, or undefined if not found.
   */
  get(id: string): ProxyConfig | undefined {
    return this.proxies.get(id);
  }

  /**
   * Returns all proxies in the pool.
   */
  getAll(): ProxyConfig[] {
    return Array.from(this.proxies.values());
  }

  /**
   * Returns proxies matching the provided filter criteria that are
   * not currently in use and not dead.
   */
  getAvailable(filter?: ProxyFilter): ProxyConfig[] {
    const results: ProxyConfig[] = [];

    for (const proxy of this.proxies.values()) {
      if (proxy.inUse) continue;
      if (proxy.healthStatus === 'dead') continue;

      if (filter) {
        if (filter.excludeIds?.has(proxy.id)) continue;
        if (filter.country && proxy.country?.toLowerCase() !== filter.country.toLowerCase()) continue;
        if (filter.state && proxy.state?.toLowerCase() !== filter.state.toLowerCase()) continue;
        if (filter.type && proxy.type !== filter.type) continue;
        if (
          filter.healthStatus &&
          filter.healthStatus.length > 0 &&
          !filter.healthStatus.includes(proxy.healthStatus)
        ) {
          continue;
        }
      }

      results.push(proxy);
    }

    return results;
  }

  /**
   * Selects the best available proxy: prioritize healthy, then lowest
   * latency, then least used. Returns null if nothing matches.
   */
  getBestProxy(filter?: ProxyFilter): ProxyConfig | null {
    const available = this.getAvailable(filter);
    if (available.length === 0) return null;

    available.sort((a, b) => {
      // Healthy first
      const healthOrder: Record<HealthStatus, number> = {
        healthy: 0,
        unknown: 1,
        degraded: 2,
        dead: 3,
      };
      const healthDiff = healthOrder[a.healthStatus] - healthOrder[b.healthStatus];
      if (healthDiff !== 0) return healthDiff;

      // Lower latency first
      const latencyDiff = a.latencyMs - b.latencyMs;
      if (Math.abs(latencyDiff) > 50) return latencyDiff;

      // Higher success rate first
      const aTotal = a.successCount + a.failureCount;
      const bTotal = b.successCount + b.failureCount;
      const aRate = aTotal > 0 ? a.successCount / aTotal : 0.5;
      const bRate = bTotal > 0 ? b.successCount / bTotal : 0.5;
      const rateDiff = bRate - aRate;
      if (Math.abs(rateDiff) > 0.01) return rateDiff;

      // Least recently used first
      return a.lastUsedAt - b.lastUsedAt;
    });

    const best = available[0];
    if (!best) {
      return null;
    }
    return best;
  }

  /**
   * Marks a proxy as currently in use.
   */
  async markUsed(id: string): Promise<void> {
    await this.acquireLock();
    try {
      const proxy = this.proxies.get(id);
      if (!proxy) {
        throw new ProxyError(`Proxy not found: ${id}`, 'PROXY_NOT_FOUND', id);
      }
      proxy.inUse = true;
      proxy.lastUsedAt = Date.now();
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Marks a proxy as free (no longer in use).
   */
  async markFree(id: string): Promise<void> {
    await this.acquireLock();
    try {
      const proxy = this.proxies.get(id);
      if (proxy) {
        proxy.inUse = false;
      }
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Updates the health status and optional latency for a proxy.
   */
  async updateHealth(id: string, status: HealthStatus, latencyMs?: number): Promise<void> {
    await this.acquireLock();
    try {
      const proxy = this.proxies.get(id);
      if (!proxy) return;

      proxy.healthStatus = status;
      proxy.lastCheckedAt = Date.now();

      if (latencyMs !== undefined) {
        proxy.latencyMs = latencyMs;
      }

      if (status === 'healthy' || status === 'degraded') {
        proxy.consecutiveFailures = 0;
      }
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Records a success for the given proxy.
   */
  async recordSuccess(id: string): Promise<void> {
    await this.acquireLock();
    try {
      const proxy = this.proxies.get(id);
      if (proxy) {
        proxy.successCount++;
        proxy.consecutiveFailures = 0;
      }
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Records a failure for the given proxy. If consecutive failures
   * exceed the threshold, the proxy is marked dead.
   */
  async recordFailure(id: string, maxConsecutiveFailures = 3): Promise<void> {
    await this.acquireLock();
    try {
      const proxy = this.proxies.get(id);
      if (!proxy) return;

      proxy.failureCount++;
      proxy.consecutiveFailures++;

      if (proxy.consecutiveFailures >= maxConsecutiveFailures) {
        proxy.healthStatus = 'dead';
        log.warn(
          { proxyId: id, failures: proxy.consecutiveFailures },
          'Proxy marked dead after consecutive failures',
        );
      }
    } finally {
      this.releaseLock();
    }
  }

  /**
   * Clears all proxies from the pool.
   */
  async clear(): Promise<void> {
    await this.acquireLock();
    try {
      this.proxies.clear();
    } finally {
      this.releaseLock();
    }
  }
}
