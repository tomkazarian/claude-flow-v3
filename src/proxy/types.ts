/**
 * Shared type definitions for the proxy module.
 */

export type ProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5';

export type ProxyType = 'residential' | 'datacenter' | 'mobile' | 'isp';

export type HealthStatus = 'healthy' | 'degraded' | 'dead' | 'unknown';

export type RotationStrategy =
  | 'round-robin'
  | 'random'
  | 'least-used'
  | 'geo-matched'
  | 'weighted';

export interface ProxyConfig {
  id: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  username?: string;
  password?: string;
  type: ProxyType;
  country?: string;
  state?: string;
  city?: string;
  provider: string;
  healthStatus: HealthStatus;
  latencyMs: number;
  successCount: number;
  failureCount: number;
  lastUsedAt: number;
  lastCheckedAt: number;
  consecutiveFailures: number;
  inUse: boolean;
  createdAt: number;
}

export interface ProxyInput {
  host: string;
  port: number;
  protocol?: ProxyProtocol;
  username?: string;
  password?: string;
  type?: ProxyType;
  country?: string;
  state?: string;
  city?: string;
  provider?: string;
}

export interface ProxyRequestOptions {
  country?: string;
  state?: string;
  type?: ProxyType;
  excludeIds?: string[];
  domain?: string;
}

export interface ProxyFilter {
  country?: string;
  state?: string;
  type?: ProxyType;
  excludeIds?: Set<string>;
  healthStatus?: HealthStatus[];
}

export interface ProxyStats {
  total: number;
  active: number;
  healthy: number;
  degraded: number;
  dead: number;
  inUse: number;
  avgLatencyMs: number;
  successRate: number;
}

export interface HealthResult {
  healthy: boolean;
  latencyMs: number;
  ip: string;
  error?: string;
}

export interface ProxyProvider {
  readonly name: string;
  fetchProxies(): Promise<ProxyConfig[]>;
  getProxy?(options?: ProxyRequestOptions): ProxyConfig;
}
