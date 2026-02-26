import type { CaptchaServiceProvider } from '../types.js';
import { TwoCaptchaProvider, type TwoCaptchaConfig } from './two-captcha.js';
import { AntiCaptchaProvider, type AntiCaptchaConfig } from './anti-captcha.js';
import { CapSolverProvider, type CapSolverConfig } from './capsolver.js';

export { TwoCaptchaProvider, type TwoCaptchaConfig } from './two-captcha.js';
export { AntiCaptchaProvider, type AntiCaptchaConfig } from './anti-captcha.js';
export { CapSolverProvider, type CapSolverConfig } from './capsolver.js';

export type CaptchaProviderType = '2captcha' | 'anti-captcha' | 'capsolver';

export interface CaptchaProviderConfig {
  type: CaptchaProviderType;
  config: TwoCaptchaConfig | AntiCaptchaConfig | CapSolverConfig;
}

/**
 * Factory function that creates a CaptchaServiceProvider based on the type string.
 */
export function createCaptchaProvider(providerConfig: CaptchaProviderConfig): CaptchaServiceProvider {
  switch (providerConfig.type) {
    case '2captcha':
      return new TwoCaptchaProvider(providerConfig.config as TwoCaptchaConfig);
    case 'anti-captcha':
      return new AntiCaptchaProvider(providerConfig.config as AntiCaptchaConfig);
    case 'capsolver':
      return new CapSolverProvider(providerConfig.config as CapSolverConfig);
    default:
      throw new Error(`Unknown CAPTCHA provider type: ${String(providerConfig.type)}`);
  }
}
