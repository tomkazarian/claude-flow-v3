export { detectCaptcha } from './captcha-detector.js';
export { CaptchaSolver } from './captcha-solver.js';

export type {
  CaptchaType,
  CaptchaDetection,
  CaptchaSolveResult,
  CaptchaServiceProvider,
  CaptchaSolverConfig,
} from './types.js';

export {
  TwoCaptchaProvider,
  AntiCaptchaProvider,
  CapSolverProvider,
  createCaptchaProvider,
  type CaptchaProviderType,
  type CaptchaProviderConfig,
  type TwoCaptchaConfig,
  type AntiCaptchaConfig,
  type CapSolverConfig,
} from './providers/index.js';

export { solveRecaptchaV2OnPage } from './solvers/recaptcha-v2.js';
export { solveRecaptchaV3OnPage } from './solvers/recaptcha-v3.js';
export { solveHCaptchaOnPage } from './solvers/hcaptcha.js';
export { solveImageCaptchaOnPage } from './solvers/image-captcha.js';
export { solveTurnstileOnPage } from './solvers/turnstile.js';
