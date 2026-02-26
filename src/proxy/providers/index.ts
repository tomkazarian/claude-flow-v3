import type { ProxyProvider } from '../types.js';
import { StaticListProvider, type StaticListConfig } from './static-list.js';
import { BrightDataProvider, type BrightDataConfig } from './brightdata.js';

export { StaticListProvider, type StaticListConfig } from './static-list.js';
export { BrightDataProvider, type BrightDataConfig } from './brightdata.js';

export type ProviderType = 'static-list' | 'brightdata';

export interface ProviderConfig {
  type: ProviderType;
  config: StaticListConfig | BrightDataConfig;
}

/**
 * Factory function that creates a ProxyProvider based on the type string.
 */
export function createProxyProvider(providerConfig: ProviderConfig): ProxyProvider {
  switch (providerConfig.type) {
    case 'static-list':
      return new StaticListProvider(providerConfig.config as StaticListConfig);
    case 'brightdata':
      return new BrightDataProvider(providerConfig.config as BrightDataConfig);
    default:
      throw new Error(`Unknown proxy provider type: ${String(providerConfig.type)}`);
  }
}
