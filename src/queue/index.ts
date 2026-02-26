/**
 * Queue module public API.
 *
 * Re-exports the queue manager, workers, schedulers, and supporting
 * utilities for use by the rest of the application.
 */

// Queue manager
export { QueueManager } from './queue-manager.js';
export type { JobData, QueueStatus, QueueManagerOptions } from './queue-manager.js';

// Workers
export {
  createDiscoveryWorker,
  createEntryWorker,
  createEmailWorker,
  createSmsWorker,
  createCleanupWorker,
} from './workers/index.js';
export type {
  DiscoveryJobData,
  EntryJobData,
  EmailJobData,
  SmsJobData,
  CleanupJobData,
  CleanupJobType,
} from './workers/index.js';

// Schedulers
export { RecurringEntryScheduler } from './schedulers/recurring-entry-scheduler.js';
export { DiscoveryScheduler } from './schedulers/discovery-scheduler.js';
export { HealthCheckScheduler } from './schedulers/health-check-scheduler.js';

// Priority calculation
export { calculatePriority } from './priorities.js';
export type { PrioritizableContest } from './priorities.js';

// Rate limiting
export { RateLimiter } from './rate-limiter.js';

// Circuit breaker
export { CircuitBreaker, CircuitState } from './circuit-breaker.js';

// Redis connection utilities
export { getRedis, isRedisAvailable, getRedisAvailability, closeRedis } from './redis.js';
