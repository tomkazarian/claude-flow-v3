/**
 * Per-domain, per-contest, and global rate limiting using Redis sliding windows.
 * All limits are enforced via atomic Lua scripts to avoid race conditions
 * in concurrent worker environments.
 */

import type IORedis from 'ioredis';
import { getLogger } from '../shared/logger.js';

const log = getLogger('queue', { component: 'rate-limiter' });

/** Default rate-limit configuration. */
const DEFAULTS = {
  /** Maximum 1 request per 5 seconds per domain. */
  DOMAIN_MAX_REQUESTS: 1,
  DOMAIN_WINDOW_MS: 5_000,

  /** Per-contest limits are derived from entry_frequency at call site. */

  /** Global max entries per hour (overridden via constructor). */
  GLOBAL_MAX_PER_HOUR: 20,
  GLOBAL_WINDOW_MS: 3_600_000,
} as const;

/**
 * Lua script implementing a sliding-window rate limiter.
 * Uses a sorted set where scores are timestamps.
 *
 * Returns 1 if the request is allowed, 0 if rate-limited.
 */
const SLIDING_WINDOW_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local windowMs = tonumber(ARGV[2])
  local maxRequests = tonumber(ARGV[3])

  -- Remove entries outside the current window
  redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)

  -- Count entries remaining in the window
  local count = redis.call('ZCARD', key)

  if count < maxRequests then
    -- Add the current request
    redis.call('ZADD', key, now, now .. '-' .. math.random(1000000))
    -- Set TTL so the key auto-expires when the window passes
    redis.call('PEXPIRE', key, windowMs)
    return 1
  else
    return 0
  end
`;

export class RateLimiter {
  private readonly redis: IORedis;
  private readonly globalMaxPerHour: number;
  private readonly keyPrefix: string;

  constructor(
    redis: IORedis,
    options?: {
      globalMaxPerHour?: number;
      keyPrefix?: string;
    },
  ) {
    this.redis = redis;
    this.globalMaxPerHour = options?.globalMaxPerHour ?? DEFAULTS.GLOBAL_MAX_PER_HOUR;
    this.keyPrefix = options?.keyPrefix ?? 'sweeps:ratelimit';
  }

  /**
   * Generic sliding-window rate limit check.
   * Returns `true` if the request is allowed, `false` if rate-limited.
   */
  async checkLimit(
    key: string,
    maxRequests: number,
    windowMs: number,
  ): Promise<boolean> {
    const fullKey = `${this.keyPrefix}:${key}`;
    const now = Date.now();

    try {
      const result = await this.redis.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        fullKey,
        now.toString(),
        windowMs.toString(),
        maxRequests.toString(),
      );

      const allowed = result === 1;
      if (!allowed) {
        log.debug({ key: fullKey, maxRequests, windowMs }, 'Rate limit hit');
      }
      return allowed;
    } catch (error) {
      log.error({ err: error, key: fullKey }, 'Rate limiter Redis error, allowing request as fallback');
      // Fail open: allow the request if Redis is unavailable
      return true;
    }
  }

  /**
   * Per-domain rate limit: max 1 request per 5 seconds per domain.
   * Returns `true` if the request is allowed.
   */
  async perDomain(domain: string): Promise<boolean> {
    return this.checkLimit(
      `domain:${domain}`,
      DEFAULTS.DOMAIN_MAX_REQUESTS,
      DEFAULTS.DOMAIN_WINDOW_MS,
    );
  }

  /**
   * Per-contest rate limit based on the contest's entry frequency.
   * - 'once': 1 entry ever (very long window)
   * - 'daily': 1 entry per 24 hours
   * - 'weekly': 1 entry per 7 days
   * - 'unlimited': no limit enforced here
   *
   * Returns `true` if the request is allowed.
   */
  async perContest(
    contestId: string,
    entryFrequency: string = 'once',
  ): Promise<boolean> {
    switch (entryFrequency) {
      case 'unlimited':
        return true;

      case 'daily':
        return this.checkLimit(
          `contest:${contestId}`,
          1,
          24 * 60 * 60 * 1000, // 24 hours
        );

      case 'weekly':
        return this.checkLimit(
          `contest:${contestId}`,
          1,
          7 * 24 * 60 * 60 * 1000, // 7 days
        );

      case 'once':
      default:
        // 1 entry in a 365-day window effectively means "once"
        return this.checkLimit(
          `contest:${contestId}`,
          1,
          365 * 24 * 60 * 60 * 1000,
        );
    }
  }

  /**
   * Global rate limit: max N entries per hour across all contests.
   * Returns `true` if the request is allowed.
   */
  async global(): Promise<boolean> {
    return this.checkLimit(
      'global:entries',
      this.globalMaxPerHour,
      DEFAULTS.GLOBAL_WINDOW_MS,
    );
  }
}
