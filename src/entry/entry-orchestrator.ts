/**
 * Entry orchestrator - the core of the platform's entry automation.
 *
 * Coordinates the complete entry flow: compliance checks, browser
 * acquisition, navigation, strategy selection and execution, CAPTCHA
 * handling, confirmation detection, screenshot capture, and result
 * recording. Emits events throughout the flow for monitoring.
 */

import { getLogger } from '../shared/logger.js';
import { eventBus } from '../shared/events.js';
import { EntryError, ComplianceError } from '../shared/errors.js';
import { generateId } from '../shared/crypto.js';
import { ENTRY_STATUSES, DEFAULT_LIMITS } from '../shared/constants.js';
import { sleep } from '../shared/timing.js';
import { parseDate } from '../shared/utils.js';
import { FormAnalyzer } from './form-analyzer.js';
import { EntryRecorder } from './entry-recorder.js';
import { selectStrategy } from './strategies/index.js';
import type {
  Contest,
  Profile,
  EntryOptions,
  EntryResult,
  Page,
  EntryContext,
} from './types.js';

const log = getLogger('entry', { component: 'orchestrator' });

// ---------------------------------------------------------------------------
// Default entry options
// ---------------------------------------------------------------------------

const DEFAULT_ENTRY_OPTIONS: Required<EntryOptions> = {
  timeoutMs: DEFAULT_LIMITS.ENTRY_TIMEOUT_MS,
  takeScreenshots: true,
  checkNewsletterForBonus: true,
  shareDataWithPartners: false,
  proxyId: '',
  maxRetries: DEFAULT_LIMITS.MAX_RETRIES,
};

// ---------------------------------------------------------------------------
// Types for browser pool integration
// ---------------------------------------------------------------------------

/**
 * Browser context interface for integration with the browser pool module.
 * The orchestrator does not own browsers directly; it acquires/releases
 * contexts through this interface.
 */
export interface BrowserContextProvider {
  acquire(options?: { proxyId?: string }): Promise<BrowserContext>;
  release(context: BrowserContext): Promise<void>;
}

export interface BrowserContext {
  id: string;
  page: Page;
}

export class EntryOrchestrator {
  private readonly recorder = new EntryRecorder();
  private readonly formAnalyzer = new FormAnalyzer();
  private browserProvider: BrowserContextProvider | null = null;

  /**
   * Set the browser context provider.
   * Must be called before entering any contests.
   */
  setBrowserProvider(provider: BrowserContextProvider): void {
    this.browserProvider = provider;
  }

  /**
   * Enter a contest for a given profile.
   *
   * This is the main entry point that orchestrates the complete flow:
   * 1. Compliance checks (age, geo, entry limits)
   * 2. Browser context acquisition (with proxy + fingerprint)
   * 3. Navigation to contest URL
   * 4. Entry method detection
   * 5. Strategy selection
   * 6. Strategy execution (form fill, CAPTCHA, submit)
   * 7. Post-submit confirmation
   * 8. Screenshot capture
   * 9. Result recording
   * 10. Browser context release
   */
  async enter(
    contest: Contest,
    profile: Profile,
    options?: EntryOptions,
  ): Promise<EntryResult> {
    const entryId = generateId();
    const startTime = Date.now();
    const opts: Required<EntryOptions> = { ...DEFAULT_ENTRY_OPTIONS, ...options };
    const errors: string[] = [];

    log.info(
      {
        entryId,
        contestId: contest.id,
        profileId: profile.id,
        url: contest.url,
        contestType: contest.type,
        entryMethod: contest.entryMethod,
      },
      'Starting entry flow',
    );

    // Step 1: Compliance checks
    try {
      await this.checkCompliance(contest, profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn({ entryId, error: message }, 'Compliance check failed');

      return this.buildFailureResult(
        entryId, contest.id, profile.id, ENTRY_STATUSES.SKIPPED,
        message, startTime, errors,
      );
    }

    // Step 2: Check entry limits
    const canEnter = await this.recorder.checkEntryLimit(contest.id, profile.id);
    if (!canEnter) {
      log.info({ entryId, contestId: contest.id }, 'Entry limit reached');
      return this.buildFailureResult(
        entryId, contest.id, profile.id, ENTRY_STATUSES.SKIPPED,
        'Entry limit reached for this contest', startTime, errors,
      );
    }

    // Step 3: Acquire browser context
    let browserContext: BrowserContext | null = null;
    let page: Page;

    if (this.browserProvider) {
      try {
        browserContext = await this.browserProvider.acquire({ proxyId: opts.proxyId || undefined });
        page = browserContext.page;
        log.debug({ contextId: browserContext.id }, 'Browser context acquired');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error({ entryId, error: message }, 'Failed to acquire browser context');
        return this.buildFailureResult(
          entryId, contest.id, profile.id, ENTRY_STATUSES.FAILED,
          `Browser acquisition failed: ${message}`, startTime, errors,
        );
      }
    } else {
      log.error({ entryId }, 'No browser provider set');
      return this.buildFailureResult(
        entryId, contest.id, profile.id, ENTRY_STATUSES.FAILED,
        'No browser provider configured', startTime, errors,
      );
    }

    try {
      // Set page timeout
      page.setDefaultTimeout(opts.timeoutMs);

      // Wrap the strategy execution with a timeout
      const result = await this.executeWithTimeout(
        () => this.executeStrategy(page, contest, profile, opts, entryId),
        opts.timeoutMs,
        entryId,
        contest.id,
        profile.id,
      );

      // Record the entry
      await this.recorder.record(result);

      // Update entry limits if successful
      if (result.status === ENTRY_STATUSES.CONFIRMED || result.status === ENTRY_STATUSES.SUBMITTED) {
        await this.recorder.updateEntryLimit(
          contest.id, profile.id, contest.entryFrequency,
        );
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);

      // Take failure screenshot
      let screenshotPath: string | undefined;
      if (opts.takeScreenshots) {
        try {
          await page.screenshot({
            path: `./data/screenshots/error_${entryId}_${Date.now()}.png`,
            fullPage: false,
          });
          screenshotPath = `./data/screenshots/error_${entryId}_${Date.now()}.png`;
        } catch {
          // Ignore screenshot errors
        }
      }

      const failResult = this.buildFailureResult(
        entryId, contest.id, profile.id, ENTRY_STATUSES.FAILED,
        message, startTime, errors, screenshotPath,
      );

      await this.recorder.record(failResult);
      return failResult;
    } finally {
      // Step 10: Release browser context
      if (browserContext && this.browserProvider) {
        try {
          await this.browserProvider.release(browserContext);
          log.debug({ contextId: browserContext.id }, 'Browser context released');
        } catch (error) {
          log.error(
            { error: error instanceof Error ? error.message : String(error) },
            'Failed to release browser context',
          );
        }
      }
    }
  }

  /**
   * Execute the appropriate entry strategy for the contest.
   */
  private async executeStrategy(
    page: Page,
    contest: Contest,
    profile: Profile,
    options: Required<EntryOptions>,
    entryId: string,
  ): Promise<EntryResult> {
    // Navigate to the contest URL first to detect the actual form structure
    log.debug({ url: contest.url }, 'Navigating to contest URL');
    await page.goto(contest.url, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_LIMITS.PAGE_LOAD_TIMEOUT_MS,
    });

    // Wait for page to stabilize
    await sleep(2000);

    // Analyze the page to determine the best strategy
    const analysis = await this.formAnalyzer.analyzeForm(page);
    const isMultiStep = analysis.isMultiStep;

    // Select strategy
    const strategy = selectStrategy(
      contest.entryMethod,
      contest.type,
      isMultiStep,
    );

    log.info(
      {
        entryId,
        strategy: strategy.name,
        entryMethod: contest.entryMethod,
        contestType: contest.type,
        isMultiStep,
      },
      'Strategy selected',
    );

    // Build execution context
    const context: EntryContext = {
      page,
      contest,
      profile,
      options,
      entryId,
    };

    // Execute the strategy
    eventBus.emit('entry:started', {
      contestId: contest.id,
      profileId: profile.id,
      entryId,
    });

    const result = await strategy.execute(context);

    if (result.status === ENTRY_STATUSES.CONFIRMED) {
      eventBus.emit('entry:submitted', {
        entryId,
        contestId: contest.id,
        profileId: profile.id,
      });
    }

    return result;
  }

  /**
   * Run the entry flow with a timeout.
   */
  private async executeWithTimeout(
    fn: () => Promise<EntryResult>,
    timeoutMs: number,
    entryId: string,
    contestId: string,
    _profileId: string,
  ): Promise<EntryResult> {
    return new Promise<EntryResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new EntryError(
            `Entry timed out after ${timeoutMs}ms`,
            'ENTRY_TIMEOUT',
            contestId,
            entryId,
          ),
        );
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Perform compliance checks before attempting entry.
   */
  private async checkCompliance(contest: Contest, profile: Profile): Promise<void> {
    // Check age requirement
    if (contest.ageRequirement !== null) {
      const age = this.calculateAge(profile.dateOfBirth);
      if (age !== null && age < contest.ageRequirement) {
        throw new ComplianceError(
          `Profile age ${age} does not meet minimum age requirement of ${contest.ageRequirement}`,
          'AGE_REQUIREMENT_NOT_MET',
          'age-requirement',
          contest.id,
        );
      }
    }

    // Check geographic restrictions
    if (contest.geoRestrictions.length > 0) {
      const profileCountry = profile.country.toUpperCase();
      const profileState = profile.state.toLowerCase();

      // Check country restrictions
      const countryRestrictions = contest.geoRestrictions.filter(
        (r) => !r.startsWith('exclude:') && !r.includes(':'),
      );
      if (countryRestrictions.length > 0) {
        const allowed = countryRestrictions.some((r) => {
          const rUpper = r.toUpperCase();
          return rUpper === profileCountry || rUpper === 'US' && profileCountry === 'US';
        });
        if (!allowed) {
          throw new ComplianceError(
            `Profile country "${profileCountry}" not in allowed list: ${countryRestrictions.join(', ')}`,
            'GEO_RESTRICTION',
            'geo-country',
            contest.id,
          );
        }
      }

      // Check state exclusions
      const stateExclusions = contest.geoRestrictions
        .filter((r) => r.startsWith('exclude:'))
        .map((r) => r.slice('exclude:'.length).toLowerCase());

      if (stateExclusions.includes(profileState)) {
        throw new ComplianceError(
          `Profile state "${profileState}" is excluded from this contest`,
          'GEO_STATE_EXCLUDED',
          'geo-state',
          contest.id,
        );
      }
    }

    // Check if contest has expired
    if (contest.endDate) {
      const endDate = contest.endDate instanceof Date
        ? contest.endDate
        : parseDate(String(contest.endDate));

      if (endDate && endDate.getTime() < Date.now()) {
        throw new ComplianceError(
          'Contest has expired',
          'CONTEST_EXPIRED',
          'expiration',
          contest.id,
        );
      }
    }

    // Check legitimacy score
    if (contest.legitimacyScore < 0.35) {
      throw new ComplianceError(
        `Contest legitimacy score (${contest.legitimacyScore.toFixed(2)}) is below minimum threshold`,
        'LOW_LEGITIMACY',
        'legitimacy',
        contest.id,
      );
    }
  }

  /**
   * Calculate age from a date of birth string.
   */
  private calculateAge(dob: string): number | null {
    const date = parseDate(dob);
    if (!date) return null;

    const today = new Date();
    let age = today.getFullYear() - date.getFullYear();
    const monthDiff = today.getMonth() - date.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
      age--;
    }
    return age;
  }

  /**
   * Build a failure/skip result.
   */
  private buildFailureResult(
    entryId: string,
    contestId: string,
    profileId: string,
    status: typeof ENTRY_STATUSES[keyof typeof ENTRY_STATUSES],
    message: string,
    startTime: number,
    errors: string[],
    screenshotPath?: string,
  ): EntryResult {
    const durationMs = Date.now() - startTime;

    eventBus.emit('entry:failed', { entryId, error: message });

    return {
      entryId,
      contestId,
      profileId,
      status,
      message,
      screenshotPath,
      timestamp: new Date().toISOString(),
      durationMs,
      errors: [...errors, message],
    };
  }

  /**
   * Get the entry recorder for external access (e.g. API routes).
   */
  getRecorder(): EntryRecorder {
    return this.recorder;
  }
}
