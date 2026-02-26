import { getLogger } from '../../shared/logger.js';
import { CaptchaError } from '../../shared/errors.js';
import { retry } from '../../shared/retry.js';
import type { CaptchaServiceProvider } from '../types.js';

const log = getLogger('captcha', { component: 'provider:capsolver' });

const API_URL = 'https://api.capsolver.com';
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface CapSolverConfig {
  apiKey: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  appId?: string;
}

interface CreateTaskResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  taskId?: string;
  status?: string;
  solution?: Record<string, unknown>;
}

interface GetTaskResultResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  status?: 'idle' | 'processing' | 'ready' | 'failed';
  solution?: {
    gRecaptchaResponse?: string;
    token?: string;
    text?: string;
  };
}

/**
 * CapSolver integration provider. Uses the same createTask/getTaskResult
 * pattern as Anti-Captcha but with CapSolver-specific task types.
 *
 * CapSolver sometimes returns solutions immediately in the createTask
 * response, making polling unnecessary.
 */
export class CapSolverProvider implements CaptchaServiceProvider {
  readonly name = 'capsolver';
  readonly priority = 3;

  private readonly apiKey: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly appId: string | undefined;

  constructor(config: CapSolverConfig) {
    this.apiKey = config.apiKey;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.appId = config.appId;
  }

  async solveRecaptchaV2(
    siteKey: string,
    pageUrl: string,
    isInvisible = false,
  ): Promise<string> {
    log.info({ siteKey, pageUrl, isInvisible }, 'Solving reCAPTCHA v2 via CapSolver');

    const task: Record<string, unknown> = {
      type: 'ReCaptchaV2TaskProxyLess',
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
    log.info({ siteKey, pageUrl, action, minScore }, 'Solving reCAPTCHA v3 via CapSolver');

    const task: Record<string, unknown> = {
      type: 'ReCaptchaV3TaskProxyLess',
      websiteURL: pageUrl,
      websiteKey: siteKey,
      pageAction: action ?? 'verify',
    };

    if (minScore !== undefined) {
      task['minScore'] = minScore;
    }

    const result = await this.createAndPoll(task);
    return result.solution?.gRecaptchaResponse ?? '';
  }

  async solveHCaptcha(siteKey: string, pageUrl: string): Promise<string> {
    log.info({ siteKey, pageUrl }, 'Solving hCaptcha via CapSolver');

    const task = {
      type: 'HCaptchaTaskProxyLess',
      websiteURL: pageUrl,
      websiteKey: siteKey,
    };

    const result = await this.createAndPoll(task);
    return result.solution?.gRecaptchaResponse ?? '';
  }

  async solveTurnstile(siteKey: string, pageUrl: string): Promise<string> {
    log.info({ siteKey, pageUrl }, 'Solving Turnstile via CapSolver');

    const task = {
      type: 'AntiTurnstileTaskProxyLess',
      websiteURL: pageUrl,
      websiteKey: siteKey,
    };

    const result = await this.createAndPoll(task);
    return result.solution?.token ?? '';
  }

  async solveImage(base64Image: string): Promise<string> {
    log.info('Solving image CAPTCHA via CapSolver');

    const task = {
      type: 'ImageToTextTask',
      body: base64Image,
    };

    const result = await this.createAndPoll(task);
    return result.solution?.text ?? '';
  }

  async getBalance(): Promise<number> {
    const response = await this.apiRequest<{
      errorId: number;
      balance?: number;
      packages?: unknown[];
    }>('/getBalance', { clientKey: this.apiKey });

    if (response.errorId !== 0) {
      throw new CaptchaError(
        'Failed to get CapSolver balance',
        'CAPTCHA_BALANCE_ERROR',
        'unknown',
        this.name,
      );
    }

    return response.balance ?? 0;
  }

  async reportGood(taskId: string): Promise<void> {
    await this.apiRequest('/feedbackTask', {
      clientKey: this.apiKey,
      taskId,
      result: { invalid: false },
    });
    log.debug({ taskId }, 'Reported good solution to CapSolver');
  }

  async reportBad(taskId: string): Promise<void> {
    await this.apiRequest('/feedbackTask', {
      clientKey: this.apiKey,
      taskId,
      result: { invalid: true },
    });
    log.debug({ taskId }, 'Reported bad solution to CapSolver');
  }

  /**
   * Creates a task and polls for its result.
   * CapSolver may return the solution immediately in the create response.
   */
  private async createAndPoll(task: Record<string, unknown>): Promise<GetTaskResultResponse> {
    const createPayload: Record<string, unknown> = {
      clientKey: this.apiKey,
      task,
    };

    if (this.appId) {
      createPayload['appId'] = this.appId;
    }

    const createResponse = await retry(
      () => this.apiRequest<CreateTaskResponse>('/createTask', createPayload),
      { maxAttempts: 3, baseDelayMs: 2000, retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'fetch failed'] },
    );

    if (createResponse.errorId !== 0) {
      throw new CaptchaError(
        `CapSolver createTask failed: ${createResponse.errorCode ?? 'unknown'} - ${createResponse.errorDescription ?? ''}`,
        'CAPTCHA_SUBMIT_FAILED',
        'unknown',
        this.name,
      );
    }

    // CapSolver may return solution immediately
    if (createResponse.status === 'ready' && createResponse.solution) {
      log.debug({ taskId: createResponse.taskId }, 'CapSolver returned immediate solution');
      return {
        errorId: 0,
        status: 'ready',
        solution: createResponse.solution as GetTaskResultResponse['solution'],
      };
    }

    if (!createResponse.taskId) {
      throw new CaptchaError(
        'CapSolver createTask returned no taskId',
        'CAPTCHA_SUBMIT_FAILED',
        'unknown',
        this.name,
      );
    }

    const taskId = createResponse.taskId;
    log.debug({ taskId }, 'CapSolver task created, polling for result');

    return this.pollResult(taskId);
  }

  /**
   * Polls the getTaskResult endpoint until the solution is ready.
   */
  private async pollResult(taskId: string): Promise<GetTaskResultResponse> {
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
          `CapSolver getTaskResult error: ${result.errorCode ?? 'unknown'} - ${result.errorDescription ?? ''}`,
          'CAPTCHA_SOLVE_FAILED',
          'unknown',
          this.name,
        );
      }

      if (result.status === 'ready') {
        log.debug({ taskId }, 'CapSolver solution received');
        return result;
      }

      if (result.status === 'failed') {
        throw new CaptchaError(
          'CapSolver task failed',
          'CAPTCHA_SOLVE_FAILED',
          'unknown',
          this.name,
        );
      }

      log.debug({ taskId, status: result.status, remainingMs: deadline - Date.now() }, 'Waiting for CapSolver solution');
      await this.sleep(this.pollIntervalMs);
    }

    throw new CaptchaError(
      `CapSolver solve timed out after ${this.timeoutMs}ms`,
      'CAPTCHA_TIMEOUT',
      'unknown',
      this.name,
    );
  }

  /**
   * Makes a POST request to the CapSolver API.
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
