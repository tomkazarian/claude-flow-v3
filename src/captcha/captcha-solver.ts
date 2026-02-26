import type { Page } from 'playwright';
import { getLogger } from '../shared/logger.js';
import { CaptchaError } from '../shared/errors.js';
import { eventBus } from '../shared/events.js';
import type {
  CaptchaDetection,
  CaptchaSolveResult,
  CaptchaServiceProvider,
  CaptchaSolverConfig,
} from './types.js';
import { solveRecaptchaV2OnPage } from './solvers/recaptcha-v2.js';
import { solveRecaptchaV3OnPage } from './solvers/recaptcha-v3.js';
import { solveHCaptchaOnPage } from './solvers/hcaptcha.js';
import { solveTurnstileOnPage } from './solvers/turnstile.js';
import { solveImageCaptchaOnPage } from './solvers/image-captcha.js';

const log = getLogger('captcha', { component: 'solver' });

/**
 * Unified CAPTCHA solver that detects the CAPTCHA type, routes to the
 * correct solving provider, injects the solution into the page, and
 * tracks cost/duration metrics.
 *
 * Falls back to alternative providers on failure.
 */
export class CaptchaSolver {
  private readonly providers = new Map<string, CaptchaServiceProvider>();
  private readonly config: Required<CaptchaSolverConfig>;

  constructor(config: CaptchaSolverConfig = {}) {
    this.config = {
      providerPriority: config.providerPriority ?? [],
      timeoutMs: config.timeoutMs ?? 120_000,
      maxProviderRetries: config.maxProviderRetries ?? 2,
    };
  }

  /**
   * Registers a CAPTCHA solving provider.
   */
  registerProvider(provider: CaptchaServiceProvider): void {
    this.providers.set(provider.name, provider);
    log.info({ provider: provider.name, priority: provider.priority }, 'CAPTCHA provider registered');
  }

  /**
   * Returns a registered provider by name, or undefined.
   */
  getProvider(name: string): CaptchaServiceProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Returns all registered providers sorted by priority (lower = higher priority).
   */
  private getOrderedProviders(): CaptchaServiceProvider[] {
    const all = Array.from(this.providers.values());

    // If explicit priority order is set, use it
    if (this.config.providerPriority.length > 0) {
      const ordered: CaptchaServiceProvider[] = [];
      for (const name of this.config.providerPriority) {
        const provider = this.providers.get(name);
        if (provider) ordered.push(provider);
      }
      // Add remaining providers not in the priority list
      for (const provider of all) {
        if (!this.config.providerPriority.includes(provider.name)) {
          ordered.push(provider);
        }
      }
      return ordered;
    }

    // Otherwise sort by priority field
    return all.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Solves a detected CAPTCHA using registered providers and
   * applies the solution to the page.
   *
   * Tries providers in priority order. If the first fails, falls
   * back to the next provider up to maxProviderRetries times.
   */
  async solve(detection: CaptchaDetection, page: Page): Promise<CaptchaSolveResult> {
    const providers = this.getOrderedProviders();

    if (providers.length === 0) {
      throw new CaptchaError(
        'No CAPTCHA providers registered',
        'CAPTCHA_NO_PROVIDER',
        detection.type,
        'none',
      );
    }

    log.info(
      { type: detection.type, siteKey: detection.siteKey, isInvisible: detection.isInvisible },
      'Attempting to solve CAPTCHA',
    );

    eventBus.emit('captcha:solving', {
      type: detection.type,
      provider: providers[0]?.name ?? 'unknown',
    });

    const maxRetries = Math.min(this.config.maxProviderRetries, providers.length);
    let lastError: Error | undefined;

    for (let i = 0; i < maxRetries; i++) {
      const provider = providers[i];
      if (!provider) break;

      const start = Date.now();

      try {
        const result = await this.solveWithProvider(detection, page, provider);
        const durationMs = Date.now() - start;

        const solveResult: CaptchaSolveResult = {
          success: true,
          token: result.token,
          solution: result.solution,
          durationMs,
          cost: result.cost,
          provider: provider.name,
        };

        eventBus.emit('captcha:solved', {
          type: detection.type,
          provider: provider.name,
          durationMs,
          cost: result.cost,
        });

        log.info(
          { type: detection.type, provider: provider.name, durationMs, cost: result.cost },
          'CAPTCHA solved successfully',
        );

        return solveResult;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const durationMs = Date.now() - start;

        log.warn(
          {
            type: detection.type,
            provider: provider.name,
            error: lastError.message,
            durationMs,
            attempt: i + 1,
            maxRetries,
          },
          'CAPTCHA solve attempt failed, trying next provider',
        );

        eventBus.emit('captcha:failed', {
          type: detection.type,
          provider: provider.name,
          error: lastError.message,
        });
      }
    }

    // All providers failed
    throw new CaptchaError(
      `All CAPTCHA providers failed for ${detection.type}: ${lastError?.message ?? 'unknown error'}`,
      'CAPTCHA_ALL_PROVIDERS_FAILED',
      detection.type,
      'all',
    );
  }

  /**
   * Routes the solve request to the correct type-specific solver and
   * provider method, then applies the result to the page.
   */
  private async solveWithProvider(
    detection: CaptchaDetection,
    page: Page,
    provider: CaptchaServiceProvider,
  ): Promise<{ token?: string; solution?: string; cost: number }> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new CaptchaError(
          `CAPTCHA solve timed out after ${this.config.timeoutMs}ms`,
          'CAPTCHA_TIMEOUT',
          detection.type,
          provider.name,
        )),
        this.config.timeoutMs,
      );
    });

    const solvePromise = this.dispatchSolve(detection, page, provider);

    return Promise.race([solvePromise, timeoutPromise]);
  }

  /**
   * Dispatches to the appropriate type-specific solver.
   */
  private async dispatchSolve(
    detection: CaptchaDetection,
    page: Page,
    provider: CaptchaServiceProvider,
  ): Promise<{ token?: string; solution?: string; cost: number }> {
    switch (detection.type) {
      case 'recaptcha-v2': {
        const token = await solveRecaptchaV2OnPage(detection, page, provider);
        return { token, cost: this.estimateCost(detection.type) };
      }

      case 'recaptcha-v3': {
        const token = await solveRecaptchaV3OnPage(detection, page, provider);
        return { token, cost: this.estimateCost(detection.type) };
      }

      case 'hcaptcha': {
        const token = await solveHCaptchaOnPage(detection, page, provider);
        return { token, cost: this.estimateCost(detection.type) };
      }

      case 'turnstile': {
        const token = await solveTurnstileOnPage(detection, page, provider);
        return { token, cost: this.estimateCost(detection.type) };
      }

      case 'image': {
        const solution = await solveImageCaptchaOnPage(detection, page, provider);
        return { solution, cost: this.estimateCost(detection.type) };
      }

      case 'funcaptcha': {
        // FunCaptcha uses a similar flow to reCAPTCHA with token injection.
        // Most providers expose it through the same createTask interface.
        throw new CaptchaError(
          'FunCaptcha/Arkose Labs solving not yet supported',
          'CAPTCHA_UNSUPPORTED_TYPE',
          detection.type,
          provider.name,
        );
      }

      default: {
        throw new CaptchaError(
          `Unknown CAPTCHA type: ${detection.type}`,
          'CAPTCHA_UNKNOWN_TYPE',
          detection.type,
          provider.name,
        );
      }
    }
  }

  /**
   * Estimates the cost of a CAPTCHA solve based on type.
   * Costs are in USD per solve, based on typical 2Captcha/Anti-Captcha pricing.
   */
  private estimateCost(type: string): number {
    const costs: Record<string, number> = {
      'recaptcha-v2': 0.003,
      'recaptcha-v3': 0.004,
      'hcaptcha': 0.003,
      'turnstile': 0.003,
      'funcaptcha': 0.005,
      'image': 0.001,
    };
    return costs[type] ?? 0.003;
  }
}
