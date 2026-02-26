export { ProxyManager, type ProxyManagerConfig } from './proxy-manager.js';
export { ProxyPool } from './proxy-pool.js';
export { ProxyHealthChecker } from './proxy-health-checker.js';
export { ProxyRotator } from './proxy-rotator.js';
export { matchProxyToContest, parseGeoRestrictions } from './geo-matcher.js';

export type {
  ProxyConfig,
  ProxyInput,
  ProxyRequestOptions,
  ProxyFilter,
  ProxyStats,
  ProxyProtocol,
  ProxyType,
  ProxyProvider,
  HealthStatus,
  HealthResult,
  RotationStrategy,
} from './types.js';

export {
  StaticListProvider,
  BrightDataProvider,
  createProxyProvider,
  type ProviderConfig,
  type ProviderType,
  type StaticListConfig,
  type BrightDataConfig,
} from './providers/index.js';
