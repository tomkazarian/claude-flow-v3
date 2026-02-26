import { getLogger } from '../../shared/logger.js';
import { CaptchaError } from '../../shared/errors.js';
import { retry } from '../../shared/retry.js';
import type { CaptchaServiceProvider } from '../types.js';

const log = getLogger('captcha', { component: 'provider:2captcha' });

const BASE_URL_IN = 'https://2captcha.com/in.php';
const BASE_URL_RES = 'https://2captcha.com/res.php';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface TwoCaptchaConfig {
  apiKey: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  softId?: string;
}

/**
 * 2Captcha integration provider. Supports reCAPTCHA v2/v3, hCaptcha,
 * Cloudflare Turnstile, and image-based CAPTCHAs via the 2Captcha HTTP API.
 */
export class TwoCaptchaProvider implements CaptchaServiceProvider {
  readonly name = '2captcha';
  readonly priority = 1;

  private readonly apiKey: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly softId: string;

  /** Stores the last task ID for reporting */
  lastTaskId: string | undefined;

  constructor(config: TwoCaptchaConfig) {
    this.apiKey = config.apiKey;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.softId = config.softId ?? '';
  }

  async solveRecaptchaV2(
    siteKey: string,
    pageUrl: string,
    isInvisible = false,
  ): Promise<string> {
    log.info({ siteKey, pageUrl, isInvisible }, 'Solving reCAPTCHA v2 via 2Captcha');

    const params = new URLSearchParams({
      key: this.apiKey,
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl,
      json: '1',
    });

    if (isInvisible) {
      params.set('invisible', '1');
    }
    if (this.softId) {
      params.set('soft_id', this.softId);
    }

    return this.submitAndPoll(params);
  }

  async solveRecaptchaV3(
    siteKey: string,
    pageUrl: string,
    action?: string,
    minScore?: number,
  ): Promise<string> {
    log.info({ siteKey, pageUrl, action, minScore }, 'Solving reCAPTCHA v3 via 2Captcha');

    const params = new URLSearchParams({
      key: this.apiKey,
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl,
      version: 'v3',
      json: '1',
    });

    if (action) {
      params.set('action', action);
    }
    if (minScore !== undefined) {
      params.set('min_score', String(minScore));
    }
    if (this.softId) {
      params.set('soft_id', this.softId);
    }

    return this.submitAndPoll(params);
  }

  async solveHCaptcha(siteKey: string, pageUrl: string): Promise<string> {
    log.info({ siteKey, pageUrl }, 'Solving hCaptcha via 2Captcha');

    const params = new URLSearchParams({
      key: this.apiKey,
      method: 'hcaptcha',
      sitekey: siteKey,
      pageurl: pageUrl,
      json: '1',
    });

    if (this.softId) {
      params.set('soft_id', this.softId);
    }

    return this.submitAndPoll(params);
  }

  async solveTurnstile(siteKey: string, pageUrl: string): Promise<string> {
    log.info({ siteKey, pageUrl }, 'Solving Turnstile via 2Captcha');

    const params = new URLSearchParams({
      key: this.apiKey,
      method: 'turnstile',
      sitekey: siteKey,
      pageurl: pageUrl,
      json: '1',
    });

    if (this.softId) {
      params.set('soft_id', this.softId);
    }

    return this.submitAndPoll(params);
  }

  async solveImage(base64Image: string): Promise<string> {
    log.info('Solving image CAPTCHA via 2Captcha');

    const params = new URLSearchParams({
      key: this.apiKey,
      method: 'base64',
      body: base64Image,
      json: '1',
    });

    if (this.softId) {
      params.set('soft_id', this.softId);
    }

    return this.submitAndPoll(params);
  }

  async getBalance(): Promise<number> {
    const params = new URLSearchParams({
      key: this.apiKey,
      action: 'getbalance',
      json: '1',
    });

    const url = `${BASE_URL_RES}?${params.toString()}`;
    const response = await this.httpGet(url);
    const data = JSON.parse(response) as { status: number; request: string };

    if (data.status !== 1) {
      throw new CaptchaError(
        `Failed to get 2Captcha balance: ${data.request}`,
        'CAPTCHA_BALANCE_ERROR',
        'unknown',
        this.name,
      );
    }

    return parseFloat(data.request);
  }

  async reportGood(taskId: string): Promise<void> {
    const params = new URLSearchParams({
      key: this.apiKey,
      action: 'reportgood',
      id: taskId,
      json: '1',
    });

    const url = `${BASE_URL_RES}?${params.toString()}`;
    await this.httpGet(url);
    log.debug({ taskId }, 'Reported good solution to 2Captcha');
  }

  async reportBad(taskId: string): Promise<void> {
    const params = new URLSearchParams({
      key: this.apiKey,
      action: 'reportbad',
      id: taskId,
      json: '1',
    });

    const url = `${BASE_URL_RES}?${params.toString()}`;
    await this.httpGet(url);
    log.debug({ taskId }, 'Reported bad solution to 2Captcha');
  }

  /**
   * Submits a CAPTCHA task and polls for the result.
   */
  private async submitAndPoll(params: URLSearchParams): Promise<string> {
    // Step 1: Submit the task
    const submitUrl = `${BASE_URL_IN}?${params.toString()}`;
    const submitResponse = await retry(
      () => this.httpGet(submitUrl),
      { maxAttempts: 3, baseDelayMs: 2000, retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'fetch failed'] },
    );

    const submitData = JSON.parse(submitResponse) as { status: number; request: string };

    if (submitData.status !== 1) {
      throw new CaptchaError(
        `2Captcha submit failed: ${submitData.request}`,
        'CAPTCHA_SUBMIT_FAILED',
        'unknown',
        this.name,
      );
    }

    const taskId = submitData.request;
    this.lastTaskId = taskId;

    log.debug({ taskId }, '2Captcha task submitted, polling for result');

    // Step 2: Poll for result
    return this.pollResult(taskId);
  }

  /**
   * Polls the 2Captcha result endpoint until the solution is ready
   * or the timeout is exceeded.
   */
  private async pollResult(taskId: string): Promise<string> {
    const params = new URLSearchParams({
      key: this.apiKey,
      action: 'get',
      id: taskId,
      json: '1',
    });

    const resultUrl = `${BASE_URL_RES}?${params.toString()}`;
    const deadline = Date.now() + this.timeoutMs;

    // Initial delay to give the solver time to start
    await this.sleep(this.pollIntervalMs);

    while (Date.now() < deadline) {
      const response = await this.httpGet(resultUrl);
      const data = JSON.parse(response) as { status: number; request: string };

      if (data.status === 1) {
        log.debug({ taskId }, '2Captcha solution received');
        return data.request;
      }

      if (data.request === 'CAPCHA_NOT_READY') {
        log.debug({ taskId, remainingMs: deadline - Date.now() }, 'Waiting for 2Captcha solution');
        await this.sleep(this.pollIntervalMs);
        continue;
      }

      // Error response
      throw new CaptchaError(
        `2Captcha solve failed: ${data.request}`,
        'CAPTCHA_SOLVE_FAILED',
        'unknown',
        this.name,
      );
    }

    throw new CaptchaError(
      `2Captcha solve timed out after ${this.timeoutMs}ms`,
      'CAPTCHA_TIMEOUT',
      'unknown',
      this.name,
    );
  }

  /**
   * Makes an HTTP GET request using the global fetch API.
   */
  private async httpGet(url: string): Promise<string> {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new CaptchaError(
        `HTTP ${response.status}: ${response.statusText}`,
        'CAPTCHA_HTTP_ERROR',
        'unknown',
        this.name,
      );
    }

    return response.text();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
