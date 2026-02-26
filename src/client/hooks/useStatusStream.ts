/**
 * SSE hook for real-time status monitoring.
 * Connects to /api/v1/status/stream and provides live system status.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

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
  type: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

interface UseStatusStreamReturn {
  status: SystemStatus | null;
  events: StatusEvent[];
  connected: boolean;
  error: string | null;
  reconnect: () => void;
}

const MAX_EVENTS = 200;

export function useStatusStream(): UseStatusStreamReturn {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [events, setEvents] = useState<StatusEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const es = new EventSource('/api/v1/status/stream');
    eventSourceRef.current = es;

    es.addEventListener('open', () => {
      setConnected(true);
      setError(null);
    });

    es.addEventListener('status', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as SystemStatus;
        setStatus(data);

        // Merge new events from status snapshot
        if (data.recentEvents?.length) {
          setEvents((prev) => {
            const existingIds = new Set(prev.map((ev) => ev.id));
            const newEvents = data.recentEvents.filter((ev) => !existingIds.has(ev.id));
            if (newEvents.length === 0) return prev;
            const merged = [...prev, ...newEvents];
            return merged.slice(-MAX_EVENTS);
          });
        }
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('activity', (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as StatusEvent;
        setEvents((prev) => {
          const merged = [...prev, event];
          return merged.slice(-MAX_EVENTS);
        });
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('error', () => {
      setConnected(false);
      setError('Connection lost. Reconnecting...');
      es.close();

      // Auto-reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3_000);
    });
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  const reconnect = useCallback(() => {
    setError(null);
    connect();
  }, [connect]);

  return { status, events, connected, error, reconnect };
}
