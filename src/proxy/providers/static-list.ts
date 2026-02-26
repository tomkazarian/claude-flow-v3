import { getLogger } from '../../shared/logger.js';
import { generateId } from '../../shared/crypto.js';
import type {
  ProxyConfig,
  ProxyProvider,
  ProxyProtocol,
  ProxyType,
} from '../types.js';

const log = getLogger('proxy', { component: 'provider:static-list' });

export interface StaticListConfig {
  /**
   * Raw proxy strings in one of these formats:
   *   - host:port
   *   - host:port:username:password
   *   - protocol://host:port
   *   - protocol://username:password@host:port
   */
  proxies: string[];
  defaultProtocol?: ProxyProtocol;
  defaultType?: ProxyType;
  defaultCountry?: string;
}

/**
 * Loads proxies from a static list of proxy strings.
 * Supports multiple common proxy string formats.
 */
export class StaticListProvider implements ProxyProvider {
  readonly name = 'static-list';
  private readonly config: StaticListConfig;

  constructor(config: StaticListConfig) {
    this.config = config;
  }

  /**
   * Parses all configured proxy strings into ProxyConfig objects.
   */
  async fetchProxies(): Promise<ProxyConfig[]> {
    const results: ProxyConfig[] = [];

    for (const raw of this.config.proxies) {
      try {
        const parsed = this.parseProxyString(raw.trim());
        if (parsed) {
          results.push(parsed);
        }
      } catch (error) {
        log.warn(
          { raw, error: error instanceof Error ? error.message : String(error) },
          'Failed to parse proxy string, skipping',
        );
      }
    }

    log.info({ count: results.length, total: this.config.proxies.length }, 'Static proxy list loaded');
    return results;
  }

  /**
   * Parses a single proxy string into a ProxyConfig.
   *
   * Supported formats:
   *   - host:port
   *   - host:port:username:password
   *   - protocol://host:port
   *   - protocol://username:password@host:port
   */
  private parseProxyString(raw: string): ProxyConfig | null {
    if (!raw || raw.length === 0) return null;

    let protocol: ProxyProtocol = this.config.defaultProtocol ?? 'http';
    let host: string;
    let port: number;
    let username: string | undefined;
    let password: string | undefined;

    // Format: protocol://...
    if (raw.includes('://')) {
      return this.parseUrlFormat(raw);
    }

    // Format: host:port or host:port:user:pass
    const parts = raw.split(':');

    if (parts.length === 2) {
      // host:port
      host = parts[0]!;
      port = parseInt(parts[1]!, 10);
    } else if (parts.length === 4) {
      // host:port:user:pass
      host = parts[0]!;
      port = parseInt(parts[1]!, 10);
      username = parts[2];
      password = parts[3];
    } else {
      log.warn({ raw }, 'Unrecognized proxy string format');
      return null;
    }

    if (isNaN(port) || port < 1 || port > 65535) {
      log.warn({ raw, port }, 'Invalid proxy port number');
      return null;
    }

    return this.buildConfig(protocol, host, port, username, password);
  }

  /**
   * Parses a URL-formatted proxy string like:
   *   - http://host:port
   *   - socks5://user:pass@host:port
   */
  private parseUrlFormat(raw: string): ProxyConfig | null {
    try {
      const url = new URL(raw);

      const protocolMap: Record<string, ProxyProtocol> = {
        'http:': 'http',
        'https:': 'https',
        'socks4:': 'socks4',
        'socks5:': 'socks5',
      };

      const protocol = protocolMap[url.protocol] ?? this.config.defaultProtocol ?? 'http';
      const host = url.hostname;
      const port = parseInt(url.port, 10) || (protocol === 'https' ? 443 : 8080);
      const username = url.username ? decodeURIComponent(url.username) : undefined;
      const password = url.password ? decodeURIComponent(url.password) : undefined;

      if (!host) {
        log.warn({ raw }, 'Missing host in proxy URL');
        return null;
      }

      return this.buildConfig(protocol, host, port, username, password);
    } catch {
      log.warn({ raw }, 'Failed to parse proxy URL');
      return null;
    }
  }

  private buildConfig(
    protocol: ProxyProtocol,
    host: string,
    port: number,
    username?: string,
    password?: string,
  ): ProxyConfig {
    return {
      id: generateId(),
      host,
      port,
      protocol,
      username,
      password,
      type: this.config.defaultType ?? 'datacenter',
      country: this.config.defaultCountry,
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
}
