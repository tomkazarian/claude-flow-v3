/**
 * Browser instance pool manager.
 * Manages multiple headless Playwright browser instances with stealth
 * configuration, tracks active/idle contexts, and auto-cleans idle
 * contexts after a configurable timeout.
 */

import { chromium, firefox, type Browser, type BrowserContext, type BrowserType } from 'playwright';
import { getLogger } from '../shared/logger.js';
import { AppError } from '../shared/errors.js';
import { createContext, type ContextOptions } from './context-factory.js';
import { getStealthArgs } from './stealth-config.js';

const logger = getLogger('browser', { component: 'browser-pool' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedBrowserType = 'chromium' | 'firefox';

export interface BrowserPoolOptions {
  /** Maximum number of concurrent browser instances. Default 3. */
  maxInstances?: number;
  /** Browser engine to launch. Default 'chromium'. */
  browserType?: SupportedBrowserType;
  /** Milliseconds before an idle context is automatically closed. Default 300_000 (5 min). */
  idleTimeoutMs?: number;
  /** Custom browser launch args appended to stealth defaults. */
  extraArgs?: string[];
  /** Whether to run headless. Default true. */
  headless?: boolean;
}

interface PooledBrowser {
  browser: Browser;
  activeContexts: Set<BrowserContext>;
  createdAt: number;
}

interface TrackedContext {
  context: BrowserContext;
  pooledBrowser: PooledBrowser;
  lastUsedAt: number;
  idle: boolean;
}

// ---------------------------------------------------------------------------
// Pool implementation
// ---------------------------------------------------------------------------

export class BrowserPool {
  private readonly maxInstances: number;
  private readonly browserType: SupportedBrowserType;
  private readonly idleTimeoutMs: number;
  private readonly extraArgs: string[];
  private readonly headless: boolean;

  private readonly browsers: PooledBrowser[] = [];
  private readonly contextMap = new Map<BrowserContext, TrackedContext>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(options: BrowserPoolOptions = {}) {
    this.maxInstances = options.maxInstances ?? 3;
    this.browserType = options.browserType ?? 'chromium';
    this.idleTimeoutMs = options.idleTimeoutMs ?? 300_000;
    this.extraArgs = options.extraArgs ?? [];
    this.headless = options.headless ?? true;

    // Start periodic idle-context cleanup
    this.cleanupTimer = setInterval(() => {
      void this.cleanupIdleContexts();
    }, Math.max(30_000, this.idleTimeoutMs / 2));

    logger.info(
      { maxInstances: this.maxInstances, browserType: this.browserType, idleTimeoutMs: this.idleTimeoutMs },
      'Browser pool initialised',
    );
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Acquires a browser context from the pool.
   * If a browser instance has capacity for another context, it reuses that
   * browser. Otherwise, a new browser is launched (up to maxInstances).
   *
   * @param contextOptions  Options forwarded to the context factory.
   */
  async acquire(contextOptions?: ContextOptions): Promise<BrowserContext> {
    this.assertNotDestroyed();

    // 1. Try to find an existing browser with room for another context
    let pooledBrowser = this.findAvailableBrowser();

    // 2. If none available, launch a new one (if under limit)
    if (!pooledBrowser) {
      if (this.browsers.length >= this.maxInstances) {
        throw new AppError(
          `Browser pool exhausted (max ${this.maxInstances} instances)`,
          'BROWSER_POOL_EXHAUSTED',
          429,
        );
      }
      pooledBrowser = await this.launchBrowser();
    }

    // 3. Create an isolated context on the chosen browser
    const context = await createContext(pooledBrowser.browser, contextOptions);
    pooledBrowser.activeContexts.add(context);

    const tracked: TrackedContext = {
      context,
      pooledBrowser,
      lastUsedAt: Date.now(),
      idle: false,
    };
    this.contextMap.set(context, tracked);

    logger.debug(
      { totalBrowsers: this.browsers.length, activeContexts: this.contextMap.size },
      'Acquired browser context',
    );

    return context;
  }

  /**
   * Returns a context to the pool, marking it as idle.
   * The context will be auto-closed after the idle timeout expires,
   * or can be reclaimed by calling `acquire()` again (though in practice
   * we create fresh contexts to avoid cookie/state leakage).
   */
  async release(context: BrowserContext): Promise<void> {
    const tracked = this.contextMap.get(context);
    if (!tracked) {
      logger.warn('Attempted to release an untracked context; closing it directly');
      await context.close().catch(() => {});
      return;
    }

    tracked.idle = true;
    tracked.lastUsedAt = Date.now();

    // Close the context immediately rather than keeping it idle,
    // since each sweepstakes entry should use a fresh context for isolation.
    await this.closeTrackedContext(tracked);

    logger.debug(
      { totalBrowsers: this.browsers.length, activeContexts: this.contextMap.size },
      'Released browser context',
    );
  }

  /**
   * Shuts down the entire pool: closes all contexts and all browsers.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Close all tracked contexts
    const contextClosePromises = Array.from(this.contextMap.values()).map(t =>
      this.closeTrackedContext(t),
    );
    await Promise.allSettled(contextClosePromises);

    // Close all browser instances
    const browserClosePromises = this.browsers.map(async pb => {
      try {
        await pb.browser.close();
      } catch (error) {
        logger.warn({ error }, 'Error closing browser during pool destruction');
      }
    });
    await Promise.allSettled(browserClosePromises);
    this.browsers.length = 0;

    logger.info('Browser pool destroyed');
  }

  // -----------------------------------------------------------------------
  // Diagnostics
  // -----------------------------------------------------------------------

  /** Number of active (non-idle) contexts across all browsers. */
  get activeContextCount(): number {
    let count = 0;
    for (const t of this.contextMap.values()) {
      if (!t.idle) count++;
    }
    return count;
  }

  /** Total contexts (active + idle) tracked by the pool. */
  get totalContextCount(): number {
    return this.contextMap.size;
  }

  /** Number of launched browser instances. */
  get browserCount(): number {
    return this.browsers.length;
  }

  /** Whether the pool has been destroyed. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private findAvailableBrowser(): PooledBrowser | undefined {
    // Pick the browser with the fewest active contexts to balance load
    let best: PooledBrowser | undefined;
    let bestCount = Infinity;
    for (const pb of this.browsers) {
      if (pb.browser.isConnected() && pb.activeContexts.size < bestCount) {
        best = pb;
        bestCount = pb.activeContexts.size;
      }
    }
    return best;
  }

  private async launchBrowser(): Promise<PooledBrowser> {
    const engine = this.resolveBrowserType();
    const args = [...getStealthArgs(), ...this.extraArgs];

    logger.info({ browserType: this.browserType }, 'Launching new browser instance');

    const browser = await engine.launch({
      headless: this.headless,
      args,
      // Disable the "navigator.webdriver" flag at the CDP level
      ignoreDefaultArgs: ['--enable-automation'],
    });

    const pooledBrowser: PooledBrowser = {
      browser,
      activeContexts: new Set(),
      createdAt: Date.now(),
    };

    // Handle unexpected browser disconnect
    browser.on('disconnected', () => {
      logger.warn('Browser disconnected unexpectedly; removing from pool');
      this.removeBrowser(pooledBrowser);
    });

    this.browsers.push(pooledBrowser);
    return pooledBrowser;
  }

  private resolveBrowserType(): BrowserType {
    switch (this.browserType) {
      case 'chromium':
        return chromium;
      case 'firefox':
        return firefox;
      default:
        return chromium;
    }
  }

  private async closeTrackedContext(tracked: TrackedContext): Promise<void> {
    try {
      await tracked.context.close();
    } catch (error) {
      logger.warn({ error }, 'Error closing browser context');
    }

    tracked.pooledBrowser.activeContexts.delete(tracked.context);
    this.contextMap.delete(tracked.context);

    // If the browser has no more contexts and we have more browsers than needed, close it
    if (tracked.pooledBrowser.activeContexts.size === 0 && this.browsers.length > 1) {
      await this.closeBrowser(tracked.pooledBrowser);
    }
  }

  private async closeBrowser(pooledBrowser: PooledBrowser): Promise<void> {
    try {
      await pooledBrowser.browser.close();
    } catch (error) {
      logger.warn({ error }, 'Error closing browser instance');
    }
    this.removeBrowser(pooledBrowser);
  }

  private removeBrowser(pooledBrowser: PooledBrowser): void {
    const idx = this.browsers.indexOf(pooledBrowser);
    if (idx !== -1) {
      this.browsers.splice(idx, 1);
    }
    // Clean up any contexts still tracked for this browser
    for (const [ctx, tracked] of this.contextMap) {
      if (tracked.pooledBrowser === pooledBrowser) {
        this.contextMap.delete(ctx);
      }
    }
  }

  private async cleanupIdleContexts(): Promise<void> {
    const now = Date.now();
    const stale: TrackedContext[] = [];

    for (const tracked of this.contextMap.values()) {
      if (tracked.idle && now - tracked.lastUsedAt > this.idleTimeoutMs) {
        stale.push(tracked);
      }
    }

    if (stale.length > 0) {
      logger.debug({ count: stale.length }, 'Cleaning up idle contexts');
      await Promise.allSettled(stale.map(t => this.closeTrackedContext(t)));
    }
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new AppError('Browser pool has been destroyed', 'BROWSER_POOL_DESTROYED', 500);
    }
  }
}
