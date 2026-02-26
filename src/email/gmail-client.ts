/**
 * Gmail API OAuth2 client for managing email operations.
 *
 * Handles OAuth2 authentication flow, message retrieval, and URL extraction
 * from email bodies. Tokens are automatically refreshed when expired.
 */

import { google, type gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getLogger } from '../shared/logger.js';
import { EmailError } from '../shared/errors.js';
import { retry } from '../shared/retry.js';

const logger = getLogger('email', { component: 'gmail-client' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  tokenType: string;
  scope: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  htmlBody: string;
  labels: string[];
  snippet: string;
}

export interface Label {
  id: string;
  name: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

const URL_REGEX = /https?:\/\/[^\s"'<>\])}]+/gi;

// ---------------------------------------------------------------------------
// GmailClient
// ---------------------------------------------------------------------------

export class GmailClient {
  private readonly oauth2Client: OAuth2Client;
  private gmail: gmail_v1.Gmail | null = null;
  private currentTokens: OAuthTokens | null = null;

  constructor(credentials: GmailCredentials) {
    this.oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      credentials.redirectUri,
    );

    this.oauth2Client.on('tokens', (tokens) => {
      if (tokens.access_token && this.currentTokens) {
        this.currentTokens = {
          ...this.currentTokens,
          accessToken: tokens.access_token,
          expiryDate: tokens.expiry_date ?? Date.now() + 3600 * 1000,
        };
        logger.debug('OAuth2 tokens auto-refreshed');
      }
    });

    logger.info('GmailClient initialized');
  }

  /**
   * Generates the OAuth2 authorization URL that the user must visit to grant
   * permission. After granting, Google will redirect to the configured
   * redirectUri with an authorization code.
   */
  getAuthUrl(): string {
    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GMAIL_SCOPES,
      prompt: 'consent',
    });
    logger.debug({ scopes: GMAIL_SCOPES }, 'Generated OAuth2 auth URL');
    return url;
  }

  /**
   * Exchanges an authorization code (from the OAuth2 callback) for access
   * and refresh tokens, then configures the internal Gmail API client.
   */
  async handleCallback(code: string): Promise<OAuthTokens> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      if (!tokens.access_token || !tokens.refresh_token) {
        throw new EmailError(
          'OAuth2 callback did not return required tokens',
          'OAUTH_TOKEN_MISSING',
          '',
        );
      }

      this.currentTokens = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date ?? Date.now() + 3600 * 1000,
        tokenType: tokens.token_type ?? 'Bearer',
        scope: tokens.scope ?? GMAIL_SCOPES.join(' '),
      };

      this.oauth2Client.setCredentials(tokens);
      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

      logger.info('OAuth2 callback handled, Gmail client configured');
      return this.currentTokens;
    } catch (error) {
      if (error instanceof EmailError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, 'Failed to handle OAuth2 callback');
      throw new EmailError(
        `OAuth2 callback failed: ${message}`,
        'OAUTH_CALLBACK_FAILED',
        '',
      );
    }
  }

  /**
   * Refreshes an expired access token using a stored refresh token.
   * Re-initializes the Gmail API client with the new credentials.
   */
  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    try {
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await this.oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new EmailError(
          'Token refresh did not return an access token',
          'TOKEN_REFRESH_FAILED',
          '',
        );
      }

      this.currentTokens = {
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token ?? refreshToken,
        expiryDate: credentials.expiry_date ?? Date.now() + 3600 * 1000,
        tokenType: credentials.token_type ?? 'Bearer',
        scope: credentials.scope ?? GMAIL_SCOPES.join(' '),
      };

      this.oauth2Client.setCredentials(credentials);
      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

      logger.info('OAuth2 tokens refreshed');
      return this.currentTokens;
    } catch (error) {
      if (error instanceof EmailError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, 'Failed to refresh OAuth2 tokens');
      throw new EmailError(
        `Token refresh failed: ${message}`,
        'TOKEN_REFRESH_FAILED',
        '',
      );
    }
  }

  /**
   * Searches Gmail for messages matching the query string.
   * Uses standard Gmail search syntax (e.g. "is:unread subject:confirm").
   */
  async listMessages(query: string, maxResults = 20): Promise<GmailMessage[]> {
    const gmail = this.getGmailClient();

    return retry(
      async () => {
        const response = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults,
        });

        const messageRefs = response.data.messages ?? [];
        if (messageRefs.length === 0) {
          return [];
        }

        const messages: GmailMessage[] = [];
        for (const ref of messageRefs) {
          if (ref.id) {
            try {
              const msg = await this.getMessage(ref.id);
              messages.push(msg);
            } catch (error) {
              logger.warn(
                { messageId: ref.id, err: error },
                'Failed to fetch individual message, skipping',
              );
            }
          }
        }

        logger.debug(
          { query, count: messages.length },
          'Listed Gmail messages',
        );
        return messages;
      },
      {
        maxAttempts: 3,
        retryableErrors: ['ECONNRESET', 'ETIMEDOUT', '429', '503'],
      },
    );
  }

  /**
   * Retrieves the full content of a single Gmail message by ID,
   * including parsed headers and decoded body.
   */
  async getMessage(messageId: string): Promise<GmailMessage> {
    const gmail = this.getGmailClient();

    return retry(
      async () => {
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full',
        });

        const data = response.data;
        const headers = data.payload?.headers ?? [];

        const getHeader = (name: string): string => {
          const header = headers.find(
            (h) => h.name?.toLowerCase() === name.toLowerCase(),
          );
          return header?.value ?? '';
        };

        const body = this.extractBodyFromPayload(data.payload, 'text/plain');
        const htmlBody = this.extractBodyFromPayload(data.payload, 'text/html');

        return {
          id: data.id ?? messageId,
          threadId: data.threadId ?? '',
          subject: getHeader('Subject'),
          from: getHeader('From'),
          to: getHeader('To'),
          date: getHeader('Date'),
          body,
          htmlBody,
          labels: data.labelIds ?? [],
          snippet: data.snippet ?? '',
        };
      },
      {
        maxAttempts: 2,
        retryableErrors: ['ECONNRESET', 'ETIMEDOUT', '429', '503'],
      },
    );
  }

  /**
   * Marks a message as read by removing the UNREAD label.
   */
  async markAsRead(messageId: string): Promise<void> {
    const gmail = this.getGmailClient();

    await retry(
      async () => {
        await gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            removeLabelIds: ['UNREAD'],
          },
        });
        logger.debug({ messageId }, 'Marked message as read');
      },
      {
        maxAttempts: 2,
        retryableErrors: ['ECONNRESET', 'ETIMEDOUT', '429', '503'],
      },
    );
  }

  /**
   * Extracts all URLs from an email HTML body.
   * Returns a deduplicated array of URL strings.
   */
  extractLinks(messageBody: string): string[] {
    if (!messageBody) {
      return [];
    }

    const matches = messageBody.match(URL_REGEX);
    if (!matches) {
      return [];
    }

    // Deduplicate and clean trailing punctuation
    const cleaned = matches.map((url) =>
      url.replace(/[.,;:!?)>\]]+$/, ''),
    );
    return [...new Set(cleaned)];
  }

  /**
   * Retrieves all labels for the authenticated Gmail account.
   */
  async getLabels(): Promise<Label[]> {
    const gmail = this.getGmailClient();

    const response = await gmail.users.labels.list({ userId: 'me' });
    const labels = response.data.labels ?? [];

    return labels.map((label) => ({
      id: label.id ?? '',
      name: label.name ?? '',
      type: label.type ?? 'user',
    }));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the initialized Gmail API client, or throws if OAuth2 has not
   * been completed.
   */
  private getGmailClient(): gmail_v1.Gmail {
    if (!this.gmail) {
      throw new EmailError(
        'Gmail client not initialized. Complete OAuth2 flow first.',
        'GMAIL_NOT_INITIALIZED',
        '',
      );
    }

    // Auto-refresh if tokens are expired
    if (
      this.currentTokens &&
      this.currentTokens.expiryDate < Date.now() + 60_000
    ) {
      logger.debug('Access token nearing expiry, triggering refresh');
      // The googleapis library handles refresh automatically when credentials
      // include a refresh_token, but we update our stored tokens via the
      // 'tokens' event listener in the constructor.
    }

    return this.gmail;
  }

  /**
   * Recursively extracts body content from a Gmail message payload,
   * looking for the specified MIME type (text/plain or text/html).
   */
  private extractBodyFromPayload(
    payload: gmail_v1.Schema$MessagePart | null | undefined,
    mimeType: string,
  ): string {
    if (!payload) {
      return '';
    }

    // Direct body match
    if (payload.mimeType === mimeType && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64url').toString('utf8');
    }

    // Recurse into parts
    if (payload.parts) {
      for (const part of payload.parts) {
        const result = this.extractBodyFromPayload(part, mimeType);
        if (result) {
          return result;
        }
      }
    }

    return '';
  }
}
