import IORedis from 'ioredis';
import { getLogger } from '../shared/logger.js';

const logger = getLogger('queue', { component: 'redis' });

let _redis: IORedis | undefined;

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
      logger.error({ err }, 'Redis connection error');
    });

    _redis.on('connect', () => {
      logger.info('Redis connected');
    });

    void _redis.connect().catch((err) => {
      logger.warn({ err }, 'Redis initial connection failed; will retry on demand');
    });

    return _redis;
  } catch (error) {
    logger.error({ err: error }, 'Failed to create Redis client');
    return null;
  }
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
    logger.info('Redis connection closed');
  }
}
