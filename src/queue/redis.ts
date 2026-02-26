import IORedis from 'ioredis';
import { getLogger } from '../shared/logger.js';

const logger = getLogger('queue', { component: 'redis' });

let _redis: IORedis | undefined;
let _redisAvailable: boolean | null = null;

/**
 * Returns a shared Redis client singleton.
 * Lazily creates the connection on first call.
 * Returns null if REDIS_URL is not configured.
 */
export function getRedis(): IORedis | null {
  const redisUrl = process.env['REDIS_URL'];

  if (!redisUrl) {
    return null;
  }

  if (_redis) {
    return _redis;
  }

  try {
    _redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null, // BullMQ requirement
      enableReadyCheck: false,
      lazyConnect: true,
    });

    _redis.on('error', (err) => {
      _redisAvailable = false;
      logger.error({ err }, 'Redis connection error');
    });

    _redis.on('connect', () => {
      _redisAvailable = true;
      logger.info('Redis connected');
    });

    void _redis.connect().catch((err) => {
      _redisAvailable = false;
      logger.warn({ err }, 'Redis initial connection failed; will retry on demand');
    });

    return _redis;
  } catch (error) {
    logger.error({ err: error }, 'Failed to create Redis client');
    return null;
  }
}

/**
 * Tests whether Redis is actually reachable by sending a PING command.
 * Returns true if the connection is alive, false otherwise.
 * This is the authoritative check -- do NOT just check if getRedis() returns non-null,
 * because IORedis will create a client even for an unreachable host.
 */
export async function isRedisAvailable(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return false;
  }

  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    _redisAvailable = pong === 'PONG';
    return _redisAvailable;
  } catch {
    _redisAvailable = false;
    return false;
  }
}

/**
 * Returns the cached availability state.
 * Call isRedisAvailable() at least once before relying on this.
 */
export function getRedisAvailability(): boolean {
  return _redisAvailable === true;
}

/**
 * Closes the Redis connection and resets the singleton.
 */
export async function closeRedis(): Promise<void> {
  if (_redis) {
    try {
      await _redis.quit();
    } catch {
      // Force disconnect if quit fails
      _redis.disconnect();
    }
    _redis = undefined;
    _redisAvailable = null;
    logger.info('Redis connection closed');
  }
}
