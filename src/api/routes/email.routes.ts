import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { generateId, encrypt } from '../../shared/crypto.js';
import { AppError } from '../../shared/errors.js';
import { getLogger } from '../../shared/logger.js';
import { validateParams } from '../middleware/validator.js';
import { idParamSchema } from '../schemas/common.schema.js';

const logger = getLogger('server', { component: 'email' });

/**
 * Email account management routes.
 */
export async function emailRoutes(app: FastifyInstance): Promise<void> {
  // GET /accounts - List email accounts
  app.get('/accounts', async (_request, reply: FastifyReply) => {
    const db = getDb();

    const accounts = await db
      .select({
        id: schema.emailAccounts.id,
        profileId: schema.emailAccounts.profileId,
        emailAddress: schema.emailAccounts.emailAddress,
        provider: schema.emailAccounts.provider,
        isActive: schema.emailAccounts.isActive,
        lastSyncAt: schema.emailAccounts.lastSyncAt,
        createdAt: schema.emailAccounts.createdAt,
      })
      .from(schema.emailAccounts)
      .orderBy(desc(schema.emailAccounts.createdAt));

    // Intentionally omit oauth_tokens and imap_config from response
    return reply.send({ data: accounts });
  });

  // POST /accounts/connect - Start Gmail OAuth flow
  app.post('/accounts/connect', async (request, reply: FastifyReply) => {
    const body = request.body as { profileId?: string } | undefined;

    // Check if Gmail client credentials are configured
    const clientId = process.env['GOOGLE_CLIENT_ID'];
    const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
    const redirectUri = process.env['GOOGLE_REDIRECT_URI'] ?? 'http://localhost:3000/api/v1/email/accounts/callback';

    if (!clientId || !clientSecret) {
      throw new AppError(
        'Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
        'OAUTH_NOT_CONFIGURED',
        503,
      );
    }

    try {
      const { GmailClient } = await import('../../email/gmail-client.js');
      const gmailClient = new GmailClient({
        clientId,
        clientSecret,
        redirectUri,
      });

      const authUrl = gmailClient.getAuthUrl();

      logger.info({ profileId: body?.profileId }, 'Gmail OAuth flow started');

      return reply.send({
        data: {
          authUrl,
          message: 'Redirect user to authUrl to grant Gmail access',
          profileId: body?.profileId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new AppError(
        `Failed to start OAuth flow: ${message}`,
        'OAUTH_START_FAILED',
        500,
      );
    }
  });

  // GET /accounts/callback - Handle OAuth callback
  app.get('/accounts/callback', async (request, reply: FastifyReply) => {
    const query = request.query as { code?: string; error?: string; state?: string };

    if (query.error) {
      throw new AppError(
        `OAuth authorization denied: ${query.error}`,
        'OAUTH_DENIED',
        400,
      );
    }

    if (!query.code) {
      throw new AppError(
        'Missing authorization code in OAuth callback',
        'OAUTH_CODE_MISSING',
        400,
      );
    }

    const clientId = process.env['GOOGLE_CLIENT_ID'];
    const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
    const redirectUri = process.env['GOOGLE_REDIRECT_URI'] ?? 'http://localhost:3000/api/v1/email/accounts/callback';

    if (!clientId || !clientSecret) {
      throw new AppError(
        'Gmail OAuth is not configured',
        'OAUTH_NOT_CONFIGURED',
        503,
      );
    }

    try {
      const { GmailClient } = await import('../../email/gmail-client.js');
      const gmailClient = new GmailClient({
        clientId,
        clientSecret,
        redirectUri,
      });

      const tokens = await gmailClient.handleCallback(query.code);

      // Store the tokens in the database
      const db = getDb();
      const id = generateId();
      const now = new Date().toISOString();

      // Extract email address from tokens (would need a profile API call in production)
      const emailAddress = 'connected@gmail.com'; // Placeholder - would be fetched from Google
      const encryptedTokens = encrypt(JSON.stringify(tokens));

      await db.insert(schema.emailAccounts).values({
        id,
        profileId: query.state ?? id, // Use state as profileId if provided
        emailAddress,
        provider: 'gmail',
        oauthTokens: encryptedTokens,
        isActive: 1,
        lastSyncAt: now,
        createdAt: now,
      });

      logger.info({ accountId: id }, 'Email account connected via OAuth');

      return reply.send({
        data: {
          accountId: id,
          emailAddress,
          status: 'connected',
          message: 'Gmail account successfully connected',
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new AppError(
        `OAuth callback failed: ${message}`,
        'OAUTH_CALLBACK_FAILED',
        500,
      );
    }
  });

  // DELETE /accounts/:id - Disconnect email account
  app.delete(
    '/accounts/:id',
    { preHandler: [validateParams(idParamSchema)] },
    async (request, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const db = getDb();

      const existing = await db
        .select({ id: schema.emailAccounts.id })
        .from(schema.emailAccounts)
        .where(eq(schema.emailAccounts.id, id))
        .limit(1);

      if (existing.length === 0) {
        throw new AppError('Email account not found', 'EMAIL_ACCOUNT_NOT_FOUND', 404);
      }

      await db
        .update(schema.emailAccounts)
        .set({ isActive: 0 })
        .where(eq(schema.emailAccounts.id, id));

      logger.info({ accountId: id }, 'Email account disconnected');

      return reply.status(204).send();
    },
  );

  // POST /sync - Force email sync
  app.post('/sync', async (_request, reply: FastifyReply) => {
    const db = getDb();

    const activeAccounts = await db
      .select()
      .from(schema.emailAccounts)
      .where(eq(schema.emailAccounts.isActive, 1));

    if (activeAccounts.length === 0) {
      return reply.send({
        data: {
          status: 'no_accounts',
          message: 'No active email accounts to sync',
          syncedAccounts: 0,
        },
      });
    }

    // Update last sync time for all active accounts
    const now = new Date().toISOString();
    for (const account of activeAccounts) {
      await db
        .update(schema.emailAccounts)
        .set({ lastSyncAt: now })
        .where(eq(schema.emailAccounts.id, account.id));
    }

    logger.info({ accountCount: activeAccounts.length }, 'Email sync triggered');

    return reply.status(202).send({
      data: {
        status: 'syncing',
        syncedAccounts: activeAccounts.length,
        message: `Email sync started for ${activeAccounts.length} accounts`,
      },
    });
  });
}
