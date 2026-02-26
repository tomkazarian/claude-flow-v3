import { getLogger } from '../../shared/logger.js';
import { CaptchaError } from '../../shared/errors.js';
import { retry } from '../../shared/retry.js';
import type { CaptchaServiceProvider } from '../types.js';

const log = getLogger('captcha', { component: 'provider:anti-captcha' });

const API_URL = 'https://api.anti-captcha.com';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface AntiCaptchaConfig {
  apiKey: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  softId?: number;
}

interface CreateTaskResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  taskId?: number;
}

interface GetTaskResultResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  status?: 'processing' | 'ready';
  solution?: {
    gRecaptchaResponse?: string;
    token?: string;
    text?: string;
  };
  cost?: string;
}

/**
 * Anti-Captcha integration provider. Uses the createTask/getTaskResult
 * API pattern to solve reCAPTCHA v2/v3, hCaptcha, Turnstile, and image CAPTCHAs.
 */
export class AntiCaptchaProvider implements CaptchaServiceProvider {
  readonly name = 'anti-captcha';
  readonly priority = 2;

  private readonly apiKey: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly softId: number | undefined;

  constructor(config: AntiCaptchaConfig) {
    this.apiKey = config.apiKey;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.softId = config.softId;
  }

  async solveRecaptchaV2(
    siteKey: string,
    pageUrl: string,
    isInvisible = false,
  ): Promise<string> {
    log.info({ siteKey, pageUrl, isInvisible }, 'Solving reCAPTCHA v2 via Anti-Captcha');

    const task: Record<string, unknown> = {
      type: 'NoCaptchaTaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey,
    };

    if (isInvisible) {
      task['isInvisible'] = true;
    }

    const result = await this.createAndPoll(task);
    return result.solution?.gRecaptchaResponse ?? '';
  }

  async solveRecaptchaV3(
    siteKey: string,
    pageUrl: string,
    action?: string,
    minScore?: number,
  ): Promise<string> {
    log.info({ siteKey, pageUrl, action, minScore }, 'Solving reCAPTCHA v3 via Anti-Captcha');

    const task: Record<string, unknown> = {
      type: 'RecaptchaV3TaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey,
      minScore: minScore ?? 0.3,
    };

    if (action) {
      task['pageAction'] = action;
    }

    const result = await this.createAndPoll(task);
    return result.solution?.gRecaptchaResponse ?? '';
  }

  async solveHCaptcha(siteKey: string, pageUrl: string): Promise<string> {
    log.info({ siteKey, pageUrl }, 'Solving hCaptcha via Anti-Captcha');

    const task = {
      type: 'HCaptchaTaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey,
    };

    const result = await this.createAndPoll(task);
    return result.solution?.gRecaptchaResponse ?? '';
  }

  async solveTurnstile(siteKey: string, pageUrl: string): Promise<string> {
    log.info({ siteKey, pageUrl }, 'Solving Turnstile via Anti-Captcha');

    const task = {
      type: 'TurnstileTaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey,
    };

    const result = await this.createAndPoll(task);
    return result.solution?.token ?? '';
  }

  async solveImage(base64Image: string): Promise<string> {
    log.info('Solving image CAPTCHA via Anti-Captcha');

    const task = {
      type: 'ImageToTextTask',
      body: base64Image,
    };

    const result = await this.createAndPoll(task);
    return result.solution?.text ?? '';
  }

  async getBalance(): Promise<number> {
    const response = await this.apiRequest<{ errorId: number; balance?: number }>(
      '/getBalance',
      { clientKey: this.apiKey },
    );

    if (response.errorId !== 0) {
      throw new CaptchaError(
        'Failed to get Anti-Captcha balance',
        'CAPTCHA_BALANCE_ERROR',
        'unknown',
        this.name,
      );
    }

    return response.balance ?? 0;
  }

  async reportGood(taskId: string): Promise<void> {
    await this.apiRequest('/reportCorrectRecaptcha', {
      clientKey: this.apiKey,
      taskId: parseInt(taskId, 10),
    });
    log.debug({ taskId }, 'Reported good solution to Anti-Captcha');
  }

  async reportBad(taskId: string): Promise<void> {
    await this.apiRequest('/reportIncorrectRecaptcha', {
      clientKey: this.apiKey,
      taskId: parseInt(taskId, 10),
    });
    log.debug({ taskId }, 'Reported bad solution to Anti-Captcha');
  }

  /**
   * Creates a task and polls for its result.
   */
  private async createAndPoll(task: Record<string, unknown>): Promise<GetTaskResultResponse> {
    // Create task
    const createPayload: Record<string, unknown> = {
      clientKey: this.apiKey,
      task,
    };

    if (this.softId) {
      createPayload['softId'] = this.softId;
    }

    const createResponse = await retry(
      () => this.apiRequest<CreateTaskResponse>('/createTask', createPayload),
      { maxAttempts: 3, baseDelayMs: 2000, retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'fetch failed'] },
    );

    if (createResponse.errorId !== 0 || !createResponse.taskId) {
      throw new CaptchaError(
        `Anti-Captcha createTask failed: ${createResponse.errorCode ?? 'unknown'} - ${createResponse.errorDescription ?? ''}`,
        'CAPTCHA_SUBMIT_FAILED',
        'unknown',
        this.name,
      );
    }

    const taskId = createResponse.taskId;
    log.debug({ taskId }, 'Anti-Captcha task created, polling for result');

    // Poll for result
    return this.pollResult(taskId);
  }

  /**
   * Polls the getTaskResult endpoint until the solution is ready
   * or the timeout is exceeded.
   */
  private async pollResult(taskId: number): Promise<GetTaskResultResponse> {
    const deadline = Date.now() + this.timeoutMs;

    // Initial wait
    await this.sleep(this.pollIntervalMs);

    while (Date.now() < deadline) {
      const result = await this.apiRequest<GetTaskResultResponse>('/getTaskResult', {
        clientKey: this.apiKey,
        taskId,
      });

      if (result.errorId !== 0) {
        throw new CaptchaError(
          `Anti-Captcha getTaskResult error: ${result.errorCode ?? 'unknown'} - ${result.errorDescription ?? ''}`,
          'CAPTCHA_SOLVE_FAILED',
          'unknown',
          this.name,
        );
      }

      if (result.status === 'ready') {
        log.debug({ taskId }, 'Anti-Captcha solution received');
        return result;
      }

      log.debug({ taskId, remainingMs: deadline - Date.now() }, 'Waiting for Anti-Captcha solution');
      await this.sleep(this.pollIntervalMs);
    }

    throw new CaptchaError(
      `Anti-Captcha solve timed out after ${this.timeoutMs}ms`,
      'CAPTCHA_TIMEOUT',
      'unknown',
      this.name,
    );
  }

  /**
   * Makes a POST request to the Anti-Captcha API.
   */
  private async apiRequest<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const url = `${API_URL}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

    return response.json() as Promise<T>;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
