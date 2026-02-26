/**
 * Manages unsubscribing from unwanted newsletters and mailing lists.
 *
 * Finds unsubscribe links in email bodies and clicks them to reduce
 * inbox noise from promotional emails unrelated to active sweepstakes.
 */

import { getLogger } from '../shared/logger.js';
import { retry } from '../shared/retry.js';
import type { GmailClient } from './gmail-client.js';

const logger = getLogger('email', { component: 'unsubscribe-manager' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UnsubscribeResult {
  emailId: string;
  success: boolean;
  url: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNSUBSCRIBE_PATTERNS = [
  /https?:\/\/[^\s"'<>]*unsub[^\s"'<>]*/gi,
  /https?:\/\/[^\s"'<>]*opt-?out[^\s"'<>]*/gi,
  /https?:\/\/[^\s"'<>]*remove[^\s"'<>]*(?:list|mail|email)[^\s"'<>]*/gi,
  /https?:\/\/[^\s"'<>]*manage[^\s"'<>]*(?:preference|subscription)[^\s"'<>]*/gi,
];

// ---------------------------------------------------------------------------
// UnsubscribeManager
// ---------------------------------------------------------------------------

export class UnsubscribeManager {
  private readonly gmailClient: GmailClient;

  constructor(gmailClient: GmailClient) {
    this.gmailClient = gmailClient;
  }

  /**
   * Searches an email body for an unsubscribe link using common URL patterns.
   * Returns the first matching URL, or null if none found.
   */
  findUnsubscribeLink(emailBody: string): string | null {
    if (!emailBody) {
      return null;
    }

    for (const pattern of UNSUBSCRIBE_PATTERNS) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      const match = pattern.exec(emailBody);
      if (match) {
        const url = match[0].replace(/[.,;:!?)>\]'"]+$/, '');
        return url;
      }
    }

    // Try to find List-Unsubscribe header links in raw body
    const listUnsub = emailBody.match(
      /List-Unsubscribe:\s*<(https?:\/\/[^>]+)>/i,
    );
    if (listUnsub?.[1]) {
      return listUnsub[1];
    }

    return null;
  }

  /**
   * Clicks an unsubscribe link using a simple HTTP GET request.
   * Most unsubscribe endpoints only require a GET to process the request.
   */
  async unsubscribe(url: string): Promise<boolean> {
    try {
      const result = await retry(
        async () => {
          const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(15_000),
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });

          if (!response.ok && response.status !== 302 && response.status !== 301) {
            throw new Error(
              `Unsubscribe request returned status ${response.status}`,
            );
          }

          return true;
        },
        {
          maxAttempts: 2,
          retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'fetch failed'],
        },
      );

      logger.info({ url }, 'Successfully unsubscribed');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ url, err: error }, `Unsubscribe failed: ${message}`);
      return false;
    }
  }

  /**
   * Processes multiple emails for unsubscription. Fetches each email,
   * finds the unsubscribe link, and clicks it.
   */
  async bulkUnsubscribe(emailIds: string[]): Promise<UnsubscribeResult[]> {
    const results: UnsubscribeResult[] = [];

    logger.info(
      { count: emailIds.length },
      'Starting bulk unsubscribe',
    );

    for (const emailId of emailIds) {
      try {
        const message = await this.gmailClient.getMessage(emailId);
        const body = message.htmlBody || message.body;
        const unsubUrl = this.findUnsubscribeLink(body);

        if (!unsubUrl) {
          results.push({
            emailId,
            success: false,
            url: null,
            error: 'No unsubscribe link found',
          });
          logger.debug(
            { emailId, subject: message.subject },
            'No unsubscribe link found in email',
          );
          continue;
        }

        const success = await this.unsubscribe(unsubUrl);
        results.push({ emailId, success, url: unsubUrl });

        if (success) {
          // Mark as read after successful unsubscribe
          await this.gmailClient.markAsRead(emailId).catch((err) => {
            logger.warn(
              { emailId, err },
              'Failed to mark email as read after unsubscribe',
            );
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          emailId,
          success: false,
          url: null,
          error: message,
        });
        logger.error(
          { emailId, err: error },
          `Failed to process email for unsubscribe: ${message}`,
        );
      }
    }

    const successCount = results.filter((r) => r.success).length;
    logger.info(
      { total: emailIds.length, success: successCount },
      'Bulk unsubscribe complete',
    );

    return results;
  }
}
