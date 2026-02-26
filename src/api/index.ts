import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.routes.js';
import { contestRoutes } from './routes/contests.routes.js';
import { entryRoutes } from './routes/entries.routes.js';
import { profileRoutes } from './routes/profiles.routes.js';
import { queueRoutes } from './routes/queue.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { analyticsRoutes } from './routes/analytics.routes.js';
import { discoveryRoutes } from './routes/discovery.routes.js';
import { proxyRoutes } from './routes/proxy.routes.js';
import { emailRoutes } from './routes/email.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { statusRoutes } from './routes/status.routes.js';

/**
 * Registers all API route modules under the /api/v1 prefix.
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes, { prefix: '/api/v1/health' });
  await app.register(dashboardRoutes, { prefix: '/api/v1/dashboard' });
  await app.register(contestRoutes, { prefix: '/api/v1/contests' });
  await app.register(entryRoutes, { prefix: '/api/v1/entries' });
  await app.register(profileRoutes, { prefix: '/api/v1/profiles' });
  await app.register(queueRoutes, { prefix: '/api/v1/queue' });
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' });
  await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
  await app.register(discoveryRoutes, { prefix: '/api/v1/discovery' });
  await app.register(proxyRoutes, { prefix: '/api/v1/proxy' });
  await app.register(emailRoutes, { prefix: '/api/v1/email' });
  await app.register(statusRoutes, { prefix: '/api/v1/status' });
}
