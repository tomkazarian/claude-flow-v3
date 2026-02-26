import { getLogger } from './logger.js';

const log = getLogger('queue');

export interface RetryOptions {
  /** Maximum number of attempts (including the first call). Default: 3 */
  maxAttempts?: number;
  /** Initial delay in milliseconds before the first retry. Default: 1000 */
  baseDelayMs?: number;
  /** Upper bound on delay in milliseconds. Default: 30000 */
  maxDelayMs?: number;
  /** Multiplier applied to the delay after each attempt. Default: 2 */
  backoffMultiplier?: number;
  /** Jitter as a fraction of the computed delay (0-1). Default: 0.1 */
  jitterFactor?: number;
  /**
   * If provided, only errors whose `code` or `message` contains one of
   * these strings will trigger a retry. All others are thrown immediately.
   */
  retryableErrors?: string[];
  /** Called before each retry. Useful for logging or metrics. */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryableErrors' | 'onRetry'>> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

function isRetryable(error: unknown, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return true;
  }
  const message =
    error instanceof Error ? error.message : String(error);
  const code =
    error instanceof Error && 'code' in error
      ? String((error as Error & { code: string }).code)
      : '';

  return patterns.some(
    (pattern) =>
      message.includes(pattern) || code.includes(pattern),
  );
}

function computeDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitterFactor: number,
): number {
  const exponentialDelay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  const capped = Math.min(exponentialDelay, maxDelayMs);
  const jitter = capped * jitterFactor * (Math.random() * 2 - 1); // +/- jitterFactor
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * Executes `fn` and retries on failure using exponential backoff with jitter.
 *
 * @example
 * ```ts
 * const result = await retry(
 *   () => fetchContestPage(url),
 *   { maxAttempts: 5, retryableErrors: ['ECONNRESET', 'ETIMEDOUT'] },
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = DEFAULT_OPTIONS.maxAttempts,
    baseDelayMs = DEFAULT_OPTIONS.baseDelayMs,
    maxDelayMs = DEFAULT_OPTIONS.maxDelayMs,
    backoffMultiplier = DEFAULT_OPTIONS.backoffMultiplier,
    jitterFactor = DEFAULT_OPTIONS.jitterFactor,
    retryableErrors,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Non-retryable error: throw immediately
      if (!isRetryable(error, retryableErrors)) {
        throw lastError;
      }

      // Exhausted all attempts
      if (attempt >= maxAttempts) {
        break;
      }

      const delayMs = computeDelay(
        attempt,
        baseDelayMs,
        maxDelayMs,
        backoffMultiplier,
        jitterFactor,
      );

      log.warn(
        {
          attempt,
          maxAttempts,
          delayMs,
          error: lastError.message,
        },
        `Retry attempt ${attempt}/${maxAttempts} after ${delayMs}ms`,
      );

      if (onRetry) {
        onRetry(lastError, attempt, delayMs);
      }

      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
