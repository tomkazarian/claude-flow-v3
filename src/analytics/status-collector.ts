/**
 * Real-time system status collector.
 * Aggregates live metrics from all subsystems for the status monitor.
 */

import EventEmitter from 'eventemitter3';
import { getLogger } from '../shared/logger.js';

const log = getLogger('analytics', { service: 'status-collector' });

export interface SystemStatus {
  timestamp: string;
  uptime: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  entries: {
    active: number;
    completedToday: number;
    failedToday: number;
    successRate: number;
    avgDurationMs: number;
  };
  queues: {
    name: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    paused: boolean;
  }[];
  browsers: {
    active: number;
    max: number;
    available: number;
  };
  captcha: {
    solvedToday: number;
    failedToday: number;
    solveRate: number;
    avgSolveTimeMs: number;
    provider: string | null;
  };
  proxies: {
    total: number;
    healthy: number;
    unhealthy: number;
    rotationStrategy: string;
  };
  discovery: {
    lastRunAt: string | null;
    contestsFound: number;
    activeSources: number;
  };
  recentEvents: StatusEvent[];
}

export interface StatusEvent {
  id: string;
  type:
    | 'entry_started'
    | 'entry_completed'
    | 'entry_failed'
    | 'captcha_solved'
    | 'captcha_failed'
    | 'win_detected'
    | 'error'
    | 'discovery_complete'
    | 'queue_paused'
    | 'queue_resumed';
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

interface StatusCollectorEvents {
  event: (event: StatusEvent) => void;
}

class StatusCollector extends EventEmitter<StatusCollectorEvents> {
  private events: StatusEvent[] = [];
  private maxEvents = 100;
  private startTime = Date.now();

  /**
   * Record a status event. Events are kept in a ring buffer.
   */
  recordEvent(event: Omit<StatusEvent, 'id' | 'timestamp'>): void {
    const fullEvent: StatusEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.events.push(fullEvent);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    log.debug({ eventType: fullEvent.type }, 'Status event recorded');

    // Emit for SSE listeners
    this.emit('event', fullEvent);
  }

  /**
   * Get recent events, optionally filtered by type.
   */
  getRecentEvents(limit = 50, type?: string): StatusEvent[] {
    let filtered: StatusEvent[] = this.events;
    if (type) {
      filtered = filtered.filter((e) => e.type === type);
    }
    return filtered.slice(-limit);
  }

  /**
   * Collect current system status snapshot.
   */
  async getStatus(): Promise<SystemStatus> {
    const mem = process.memoryUsage();

    // Try to get queue stats
    let queues: SystemStatus['queues'] = [];
    try {
      const { getRedis } = await import('../queue/redis.js');
      const redis = getRedis();
      if (redis) {
        const queueNames = ['entry', 'discovery', 'email-check', 'proxy-health', 'analytics'];
        for (const name of queueNames) {
          try {
            const waiting = await redis.llen(`bull:${name}:wait`);
            const active = await redis.llen(`bull:${name}:active`);
            const completed = Number((await redis.get(`bull:${name}:completed`)) ?? 0);
            const failed = Number((await redis.get(`bull:${name}:failed`)) ?? 0);
            const pausedFlag = await redis.hexists(`bull:${name}:meta`, 'paused');
            queues.push({ name, waiting, active, completed, failed, paused: pausedFlag === 1 });
          } catch {
            queues.push({ name, waiting: 0, active: 0, completed: 0, failed: 0, paused: false });
          }
        }
      }
    } catch {
      // Redis not available
    }

    // Try to get entry stats for today
    let entries: SystemStatus['entries'] = {
      active: 0,
      completedToday: 0,
      failedToday: 0,
      successRate: 0,
      avgDurationMs: 0,
    };
    try {
      const { getDb } = await import('../db/index.js');
      const { sql, gte, count } = await import('drizzle-orm');
      const { entries: entriesTable } = await import('../db/schema.js');
      const db = getDb();

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayIso = todayStart.toISOString();

      const result = db
        .select({
          total: count(),
          successful: sql<number>`SUM(CASE WHEN status IN ('submitted','confirmed','won') THEN 1 ELSE 0 END)`,
          failed: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
          avgDuration: sql<number>`AVG(duration_ms)`,
        })
        .from(entriesTable)
        .where(gte(entriesTable.createdAt, todayIso))
        .get();

      if (result) {
        const total = result.total ?? 0;
        const successful = Number(result.successful ?? 0);
        const failed = Number(result.failed ?? 0);
        entries = {
          active: queues.find((q) => q.name === 'entry')?.active ?? 0,
          completedToday: successful,
          failedToday: failed,
          successRate: total > 0 ? Math.round((successful / total) * 10000) / 100 : 0,
          avgDurationMs: Math.round(Number(result.avgDuration ?? 0)),
        };
      }
    } catch {
      // DB not available
    }

    // Try to get captcha stats for today
    let captcha: SystemStatus['captcha'] = {
      solvedToday: 0,
      failedToday: 0,
      solveRate: 0,
      avgSolveTimeMs: 0,
      provider: null,
    };
    try {
      const { getDb } = await import('../db/index.js');
      const { gte, count } = await import('drizzle-orm');
      const { costLog } = await import('../db/schema.js');
      const db = getDb();

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayIso = todayStart.toISOString();

      const result = db
        .select({
          total: count(),
          provider: costLog.provider,
        })
        .from(costLog)
        .where(gte(costLog.createdAt, todayIso))
        .get();

      if (result) {
        captcha.solvedToday = result.total ?? 0;
        captcha.provider = result.provider ?? null;
      }
    } catch {
      // DB not available
    }

    // Browser pool info
    const browsers: SystemStatus['browsers'] = {
      active: 0,
      max: Number(process.env['MAX_BROWSER_INSTANCES'] ?? 3),
      available: Number(process.env['MAX_BROWSER_INSTANCES'] ?? 3),
    };

    // Proxy info
    const proxies: SystemStatus['proxies'] = {
      total: 0,
      healthy: 0,
      unhealthy: 0,
      rotationStrategy: 'round-robin',
    };
    try {
      const { getDb } = await import('../db/index.js');
      const { eq, count } = await import('drizzle-orm');
      const schema = await import('../db/schema.js');
      const db = getDb();

      const total = db
        .select({ count: count() })
        .from(schema.proxies)
        .get();
      const healthy = db
        .select({ count: count() })
        .from(schema.proxies)
        .where(eq(schema.proxies.healthStatus, 'healthy'))
        .get();
      proxies.total = total?.count ?? 0;
      proxies.healthy = healthy?.count ?? 0;
      proxies.unhealthy = proxies.total - proxies.healthy;
    } catch {
      // DB not available
    }

    // Discovery info
    let discovery: SystemStatus['discovery'] = {
      lastRunAt: null,
      contestsFound: 0,
      activeSources: 0,
    };
    try {
      const { getDb } = await import('../db/index.js');
      const { eq, desc, count } = await import('drizzle-orm');
      const schema = await import('../db/schema.js');
      const db = getDb();

      const activeCount = db
        .select({ count: count() })
        .from(schema.discoverySources)
        .where(eq(schema.discoverySources.isActive, 1))
        .get();
      const lastSource = db
        .select({ lastRunAt: schema.discoverySources.lastRunAt })
        .from(schema.discoverySources)
        .orderBy(desc(schema.discoverySources.lastRunAt))
        .limit(1)
        .get();
      const totalContests = db
        .select({ count: count() })
        .from(schema.contests)
        .get();

      discovery = {
        lastRunAt: lastSource?.lastRunAt ?? null,
        contestsFound: totalContests?.count ?? 0,
        activeSources: activeCount?.count ?? 0,
      };
    } catch {
      // DB not available
    }

    return {
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external,
      },
      entries,
      queues,
      browsers,
      captcha,
      proxies,
      discovery,
      recentEvents: this.getRecentEvents(20),
    };
  }
}

// Singleton
let instance: StatusCollector | null = null;

export function getStatusCollector(): StatusCollector {
  if (!instance) {
    instance = new StatusCollector();
  }
  return instance;
}
