import { getLogger } from '../../shared/logger.js';
import { generateId } from '../../shared/crypto.js';
import type {
  ProxyConfig,
  ProxyProvider,
  ProxyRequestOptions,
  ProxyType,
} from '../types.js';

const log = getLogger('proxy', { component: 'provider:brightdata' });

export interface BrightDataConfig {
  /** Bright Data customer ID */
  customerId: string;
  /** Zone name (e.g., 'residential', 'datacenter', 'isp') */
  zone: string;
  /** Zone password */
  password: string;
  /** Proxy type for this zone */
  proxyType: ProxyType;
  /** Super proxy host. Default: brd.superproxy.io */
  host?: string;
  /** Super proxy port. Default: 22225 */
  port?: number;
  /** Default country targeting (ISO 2-letter code) */
  defaultCountry?: string;
}

/**
 * Bright Data (formerly Luminati) residential proxy integration.
 * Supports country/state targeting, sticky sessions via session IDs,
 * and multiple proxy types (residential, datacenter, mobile, ISP).
 */
export class BrightDataProvider implements ProxyProvider {
  readonly name = 'brightdata';
  private readonly config: BrightDataConfig;
  private sessionCounter = 0;

  constructor(config: BrightDataConfig) {
    this.config = config;
  }

  /**
   * Creates a set of pre-configured proxy entries for Bright Data.
   * Since Bright Data uses a super-proxy with session-based routing,
   * we generate multiple proxy configs with different session IDs
   * to allow concurrent connections.
   */
  async fetchProxies(count = 10): Promise<ProxyConfig[]> {
    const proxies: ProxyConfig[] = [];

    for (let i = 0; i < count; i++) {
      const sessionId = this.generateSessionId();
      const proxy = this.buildProxyConfig(sessionId, this.config.defaultCountry);
      proxies.push(proxy);
    }

    log.info(
      { count: proxies.length, zone: this.config.zone, type: this.config.proxyType },
      'Bright Data proxies generated',
    );

    return proxies;
  }

  /**
   * Gets a single proxy with optional country/state targeting.
   * Each call generates a new session ID for a fresh IP.
   */
  getProxy(options?: ProxyRequestOptions): ProxyConfig {
    const sessionId = this.generateSessionId();
    const country = options?.country ?? this.config.defaultCountry;
    const state = options?.state;

    const proxy = this.buildProxyConfig(sessionId, country, state);

    log.debug(
      { sessionId, country, state, proxyId: proxy.id },
      'Bright Data proxy created with targeting',
    );

    return proxy;
  }

  /**
   * Builds a Bright Data username string with targeting parameters.
   *
   * Format: brd-customer-{id}-zone-{zone}[-country-{cc}][-state-{st}]-session-{sid}
   */
  private buildUsername(sessionId: string, country?: string, state?: string): string {
    const parts: string[] = [
      `brd-customer-${this.config.customerId}`,
      `zone-${this.config.zone}`,
    ];

    if (country) {
      parts.push(`country-${country.toLowerCase()}`);
    }

    if (state) {
      parts.push(`state-${state.toLowerCase()}`);
    }

    parts.push(`session-${sessionId}`);

    return parts.join('-');
  }

  /**
   * Builds a full ProxyConfig for a Bright Data session.
   */
  private buildProxyConfig(
    sessionId: string,
    country?: string,
    state?: string,
  ): ProxyConfig {
    const host = this.config.host ?? 'brd.superproxy.io';
    const port = this.config.port ?? 22225;
    const username = this.buildUsername(sessionId, country, state);

    return {
      id: generateId(),
      host,
      port,
      protocol: 'http',
      username,
      password: this.config.password,
      type: this.config.proxyType,
      country: country?.toUpperCase(),
      state: state?.toUpperCase(),
      provider: this.name,
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
  }

  /**
   * Generates a unique session ID for sticky sessions.
   * Each session ID maps to a consistent IP on Bright Data's network.
   */
  private generateSessionId(): string {
    this.sessionCounter++;
    const timestamp = Date.now().toString(36);
    const counter = this.sessionCounter.toString(36).padStart(4, '0');
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}${counter}${random}`;
  }
}
