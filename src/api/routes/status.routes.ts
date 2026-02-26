/**
 * Real-time status monitoring routes.
 * Provides SSE stream and snapshot endpoints for the status monitor.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getStatusCollector, type StatusEvent } from '../../analytics/status-collector.js';
import { getLogger } from '../../shared/logger.js';

const logger = getLogger('server', { component: 'status' });

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  const collector = getStatusCollector();

  // GET / - Current system status snapshot
  app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = await collector.getStatus();
    return reply.send({ data: status });
  });

  // GET /events - Recent events list
  app.get('/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { limit?: string; type?: string };
    const limit = Math.min(Number(query.limit ?? 50), 100);
    const events = collector.getRecentEvents(limit, query.type);
    return reply.send({ data: events });
  });

  // GET /stream - SSE endpoint for real-time updates
  app.get('/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial status snapshot
    const initialStatus = await collector.getStatus();
    reply.raw.write(`event: status\ndata: ${JSON.stringify(initialStatus)}\n\n`);

    // Send heartbeat every 15 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(
        `event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`,
      );
    }, 15_000);

    // Send periodic full status every 5 seconds
    const statusInterval = setInterval(async () => {
      try {
        const status = await collector.getStatus();
        reply.raw.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
      } catch (error) {
        logger.error({ err: error }, 'Error collecting status for SSE');
      }
    }, 5_000);

    // Forward individual events immediately
    const onEvent = (event: StatusEvent) => {
      try {
        reply.raw.write(`event: activity\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Client disconnected
      }
    };
    collector.on('event', onEvent);

    // Cleanup on disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(statusInterval);
      collector.off('event', onEvent);
      logger.debug('SSE client disconnected');
    });
  });
}
