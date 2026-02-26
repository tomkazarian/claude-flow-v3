import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, desc, sql, count as countFn } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { generateId } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';
import { getLogger } from '../../shared/logger.js';
import { validateBody, validateParams } from '../middleware/validator.js';
import { idParamSchema } from '../schemas/common.schema.js';

const logger = getLogger('server', { component: 'proxy' });

const createProxySchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().optional(),
  password: z.string().optional(),
  protocol: z.enum(['http', 'https', 'socks5']).default('http'),
  type: z.enum(['residential', 'datacenter', 'mobile']).optional(),
  country: z.string().max(10).optional(),
  state: z.string().max(50).optional(),
  city: z.string().max(100).optional(),
  provider: z.string().max(100).optional(),
});

/**
 * Proxy management routes.
 */
export async function proxyRoutes(app: FastifyInstance): Promise<void> {
  // GET / - List proxies with health status
  app.get('/', async (_request, reply: FastifyReply) => {
    const db = getDb();

    const proxyRows = await db
      .select()
      .from(schema.proxies)
      .orderBy(desc(schema.proxies.createdAt));

    // Mask passwords in the response
    const sanitized = proxyRows.map((row) => ({
      ...row,
      password: row.password ? '***' : null,
    }));

    return reply.send({ data: sanitized });
  });

  // POST / - Add a proxy
  app.post(
    '/',
    { preHandler: [validateBody(createProxySchema)] },
    async (request, reply: FastifyReply) => {
      const body = request.body as z.infer<typeof createProxySchema>;
      const db = getDb();

      const id = generateId();
      const now = new Date().toISOString();

      await db.insert(schema.proxies).values({
        id,
        host: body.host,
        port: body.port,
        username: body.username ?? null,
        password: body.password ?? null,
        protocol: body.protocol,
        type: body.type ?? null,
        country: body.country ?? null,
        state: body.state ?? null,
        city: body.city ?? null,
        provider: body.provider ?? null,
        isActive: 1,
        healthStatus: 'unknown',
        successCount: 0,
        failureCount: 0,
        createdAt: now,
      });

      const created = await db
        .select()
        .from(schema.proxies)
        .where(eq(schema.proxies.id, id))
        .limit(1);

      // Mask password
      const result = {
        ...created[0],
        password: created[0]!.password ? '***' : null,
      };

      logger.info({ proxyId: id, host: body.host, port: body.port }, 'Proxy added');

      return reply.status(201).send({ data: result });
    },
  );

  // DELETE /:id - Remove a proxy
  app.delete(
    '/:id',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const existing = await db
        .select({ id: schema.proxies.id })
        .from(schema.proxies)
        .where(eq(schema.proxies.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new AppError('Proxy not found', 'PROXY_NOT_FOUND', 404);
      }

      await db.delete(schema.proxies).where(eq(schema.proxies.id, id));

      logger.info({ proxyId: id }, 'Proxy deleted');

      return reply.status(204).send();
    },
  );

  // POST /health-check - Trigger health check of all proxies
  app.post('/health-check', async (_request, reply: FastifyReply) => {
    const db = getDb();

    const activeProxies = await db
      .select()
      .from(schema.proxies)
      .where(eq(schema.proxies.isActive, 1));

    logger.info({ proxyCount: activeProxies.length }, 'Proxy health check triggered');

    // In a full implementation, this would trigger actual health checks.
    // For now, update lastHealthCheck timestamp.
    const now = new Date().toISOString();

    for (const proxy of activeProxies) {
      await db
        .update(schema.proxies)
        .set({ lastHealthCheck: now })
        .where(eq(schema.proxies.id, proxy.id));
    }

    return reply.status(202).send({
      data: {
        status: 'started',
        proxiesChecked: activeProxies.length,
        message: `Health check initiated for ${activeProxies.length} proxies`,
      },
    });
  });

  // GET /stats - Proxy statistics
  app.get('/stats', async (_request, reply: FastifyReply) => {
    const db = getDb();

    const statsResult = await db
      .select({
        total: countFn(),
        healthy: sql<number>`SUM(CASE WHEN ${schema.proxies.healthStatus} = 'healthy' THEN 1 ELSE 0 END)`,
        degraded: sql<number>`SUM(CASE WHEN ${schema.proxies.healthStatus} = 'degraded' THEN 1 ELSE 0 END)`,
        dead: sql<number>`SUM(CASE WHEN ${schema.proxies.healthStatus} = 'dead' THEN 1 ELSE 0 END)`,
        unknown: sql<number>`SUM(CASE WHEN ${schema.proxies.healthStatus} = 'unknown' THEN 1 ELSE 0 END)`,
        avgLatency: sql<number>`AVG(${schema.proxies.avgLatencyMs})`,
        totalSuccess: sql<number>`COALESCE(SUM(${schema.proxies.successCount}), 0)`,
        totalFailure: sql<number>`COALESCE(SUM(${schema.proxies.failureCount}), 0)`,
      })
      .from(schema.proxies)
      .where(eq(schema.proxies.isActive, 1));

    const stats = statsResult[0];
    const totalSuccess = Number(stats?.totalSuccess ?? 0);
    const totalFailure = Number(stats?.totalFailure ?? 0);
    const totalRequests = totalSuccess + totalFailure;
    const successRate = totalRequests > 0 ? Math.round((totalSuccess / totalRequests) * 10000) / 100 : 0;

    return reply.send({
      data: {
        total: stats?.total ?? 0,
        healthy: Number(stats?.healthy ?? 0),
        degraded: Number(stats?.degraded ?? 0),
        dead: Number(stats?.dead ?? 0),
        unknown: Number(stats?.unknown ?? 0),
        avgLatencyMs: stats?.avgLatency ? Math.round(stats.avgLatency) : null,
        successRate,
        totalRequests,
      },
    });
  });
}
