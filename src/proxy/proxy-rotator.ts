import { getLogger } from '../shared/logger.js';
import { ProxyError } from '../shared/errors.js';
import type { ProxyPool } from './proxy-pool.js';
import type {
  ProxyConfig,
  ProxyFilter,
  RotationStrategy,
} from './types.js';

const log = getLogger('proxy', { component: 'rotator' });

/**
 * Implements multiple proxy rotation strategies, including round-robin,
 * random, least-used, geo-matched, and weighted selection.
 *
 * Also tracks per-domain proxy usage to prevent reusing the same proxy
 * for the same domain within a configurable window.
 */
export class ProxyRotator {
  /** Tracks round-robin index across calls. */
  private roundRobinIndex = 0;

  /**
   * Maps domain -> Set of proxy IDs recently used for that domain.
   * Prevents the same proxy from being used repeatedly on one domain.
   */
  private readonly domainUsage = new Map<string, Set<string>>();

  /**
   * TTL for domain usage entries in milliseconds. After this duration,
   * domain-proxy associations are cleared. Default: 30 minutes.
   */
  private readonly domainUsageTtlMs: number;

  /** Timestamps for when domain entries were created. */
  private readonly domainTimestamps = new Map<string, number>();

  constructor(
    private readonly pool: ProxyPool,
    domainUsageTtlMs = 30 * 60 * 1000,
  ) {
    this.domainUsageTtlMs = domainUsageTtlMs;
  }

  /**
   * Gets the next proxy according to the chosen rotation strategy.
   * Throws ProxyError if no suitable proxy is available.
   */
  getNext(
    strategy: RotationStrategy,
    filter?: ProxyFilter,
    domain?: string,
  ): ProxyConfig {
    // Incorporate domain exclusion into the filter
    const augmentedFilter = this.augmentFilterWithDomain(filter, domain);
    const available = this.pool.getAvailable(augmentedFilter);

    if (available.length === 0) {
      throw new ProxyError(
        'No proxies available matching the requested criteria',
        'PROXY_POOL_EXHAUSTED',
        '',
      );
    }

    let selected: ProxyConfig;

    switch (strategy) {
      case 'round-robin':
        selected = this.selectRoundRobin(available);
        break;
      case 'random':
        selected = this.selectRandom(available);
        break;
      case 'least-used':
        selected = this.selectLeastUsed(available);
        break;
      case 'geo-matched':
        selected = this.selectGeoMatched(available, filter);
        break;
      case 'weighted':
        selected = this.selectWeighted(available);
        break;
      default:
        selected = this.selectRoundRobin(available);
    }

    // Track usage for domain if provided
    if (domain) {
      this.trackDomainUsage(domain, selected.id);
    }

    log.debug(
      { strategy, proxyId: selected.id, domain, available: available.length },
      'Proxy selected by rotator',
    );

    return selected;
  }

  /**
   * Clears domain usage tracking for a specific domain or all domains.
   */
  clearDomainUsage(domain?: string): void {
    if (domain) {
      this.domainUsage.delete(domain);
      this.domainTimestamps.delete(domain);
    } else {
      this.domainUsage.clear();
      this.domainTimestamps.clear();
    }
  }

  /**
   * Round-robin: cycles through available proxies in order.
   */
  private selectRoundRobin(available: ProxyConfig[]): ProxyConfig {
    if (this.roundRobinIndex >= available.length) {
      this.roundRobinIndex = 0;
    }
    const proxy = available[this.roundRobinIndex]!;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % available.length;
    return proxy;
  }

  /**
   * Random: picks a proxy at random from the available set.
   */
  private selectRandom(available: ProxyConfig[]): ProxyConfig {
    const index = Math.floor(Math.random() * available.length);
    return available[index]!;
  }

  /**
   * Least-used: picks the proxy with the lowest total usage count.
   */
  private selectLeastUsed(available: ProxyConfig[]): ProxyConfig {
    const sorted = [...available].sort((a, b) => {
      const aTotal = a.successCount + a.failureCount;
      const bTotal = b.successCount + b.failureCount;
      return aTotal - bTotal;
    });
    return sorted[0]!;
  }

  /**
   * Geo-matched: prioritizes proxies whose country and state match
   * the filter, falling back to country-only matches.
   */
  private selectGeoMatched(
    available: ProxyConfig[],
    filter?: ProxyFilter,
  ): ProxyConfig {
    if (!filter?.country && !filter?.state) {
      // No geo constraint; fall back to weighted selection
      return this.selectWeighted(available);
    }

    // Try exact state match first
    if (filter.state) {
      const stateMatches = available.filter(
        (p) =>
          p.state?.toLowerCase() === filter.state?.toLowerCase() &&
          p.country?.toLowerCase() === filter.country?.toLowerCase(),
      );
      if (stateMatches.length > 0) {
        return this.selectWeighted(stateMatches);
      }
    }

    // Fall back to country match
    if (filter.country) {
      const countryMatches = available.filter(
        (p) => p.country?.toLowerCase() === filter.country?.toLowerCase(),
      );
      if (countryMatches.length > 0) {
        return this.selectWeighted(countryMatches);
      }
    }

    // No geo match found; use any available proxy
    log.warn(
      { country: filter.country, state: filter.state },
      'No geo-matched proxy found, falling back to weighted selection',
    );
    return this.selectWeighted(available);
  }

  /**
   * Weighted: scores each proxy based on success rate, latency, and recency.
   * Higher-scoring proxies are more likely to be selected.
   */
  private selectWeighted(available: ProxyConfig[]): ProxyConfig {
    const now = Date.now();
    const weights: number[] = [];
    let totalWeight = 0;

    for (const proxy of available) {
      const total = proxy.successCount + proxy.failureCount;
      const successRate = total > 0 ? proxy.successCount / total : 0.5;

      // Latency score: lower latency = higher score (0 to 1 range)
      const latencyScore = proxy.latencyMs > 0
        ? Math.max(0, 1 - proxy.latencyMs / 10_000)
        : 0.5;

      // Recency score: prefer proxies not used recently
      const timeSinceUse = now - proxy.lastUsedAt;
      const recencyScore = Math.min(1, timeSinceUse / (10 * 60 * 1000));

      // Combined weight (success rate is most important)
      const weight = successRate * 0.5 + latencyScore * 0.3 + recencyScore * 0.2;
      const adjustedWeight = Math.max(0.01, weight);

      weights.push(adjustedWeight);
      totalWeight += adjustedWeight;
    }

    // Weighted random selection
    let random = Math.random() * totalWeight;
    for (let i = 0; i < available.length; i++) {
      random -= weights[i]!;
      if (random <= 0) {
        return available[i]!;
      }
    }

    // Fallback to last entry (should not happen in practice)
    return available[available.length - 1]!;
  }

  /**
   * Augments the filter with domain-based exclusions.
   * Proxies recently used on the given domain are excluded.
   */
  private augmentFilterWithDomain(
    filter: ProxyFilter | undefined,
    domain: string | undefined,
  ): ProxyFilter | undefined {
    if (!domain) return filter;

    this.cleanExpiredDomainUsage(domain);
    const usedProxies = this.domainUsage.get(domain);

    if (!usedProxies || usedProxies.size === 0) return filter;

    const excludeIds = new Set<string>([
      ...(filter?.excludeIds ?? []),
      ...usedProxies,
    ]);

    return { ...filter, excludeIds };
  }

  /**
   * Records that a proxy was used for a specific domain.
   */
  private trackDomainUsage(domain: string, proxyId: string): void {
    let usage = this.domainUsage.get(domain);
    if (!usage) {
      usage = new Set();
      this.domainUsage.set(domain, usage);
      this.domainTimestamps.set(domain, Date.now());
    }
    usage.add(proxyId);
  }

  /**
   * Removes expired domain usage entries.
   */
  private cleanExpiredDomainUsage(domain: string): void {
    const timestamp = this.domainTimestamps.get(domain);
    if (timestamp && Date.now() - timestamp > this.domainUsageTtlMs) {
      this.domainUsage.delete(domain);
      this.domainTimestamps.delete(domain);
    }
  }
}
