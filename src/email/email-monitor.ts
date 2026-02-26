/**
 * Monitors Gmail for confirmation and win notification emails.
 *
 * Polls at a configurable interval for new unread messages, classifying
 * them as either confirmation emails (requiring a click) or win
 * notifications (requiring claim action).
 */

import { getLogger } from '../shared/logger.js';
import { eventBus } from '../shared/events.js';
import type { GmailClient, GmailMessage } from './gmail-client.js';

const logger = getLogger('email', { component: 'email-monitor' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmationEmail {
  emailId: string;
  subject: string;
  from: string;
  confirmationUrl: string;
  entryId?: string;
}

export interface WinEmail {
  emailId: string;
  subject: string;
  from: string;
  prizeDetails: string;
  claimUrl: string;
  claimDeadline?: string;
}

// ---------------------------------------------------------------------------
// Pattern matchers
// ---------------------------------------------------------------------------

const CONFIRMATION_SUBJECT_PATTERNS = [
  /confirm/i,
  /verify/i,
  /activate/i,
  /complete your entry/i,
  /validate your/i,
  /confirm your entry/i,
  /email verification/i,
  /action required/i,
];

const WIN_SUBJECT_PATTERNS = [
  /congratulations/i,
  /you won/i,
  /you're a winner/i,
  /you are a winner/i,
  /claim your prize/i,
  /selected as winner/i,
  /you've been selected/i,
  /prize notification/i,
  /winner notification/i,
];

const CONFIRMATION_URL_PATTERNS = [
  /confirm/i,
  /verify/i,
  /activate/i,
  /validate/i,
  /opt-?in/i,
  /subscription/i,
  /click here/i,
];

// ---------------------------------------------------------------------------
// EmailMonitor
// ---------------------------------------------------------------------------

export class EmailMonitor {
  private readonly gmailClient: GmailClient;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private processedEmailIds = new Set<string>();

  constructor(gmailClient: GmailClient) {
    this.gmailClient = gmailClient;
  }

  /**
   * Starts polling Gmail for new unread messages at the given interval.
   * Each poll checks for both confirmation and win emails.
   */
  startMonitoring(intervalMs = 30_000): void {
    if (this.isRunning) {
      logger.warn('Email monitoring is already running');
      return;
    }

    this.isRunning = true;
    logger.info({ intervalMs }, 'Starting email monitoring');

    // Run immediately on start
    void this.pollOnce();

    this.pollingTimer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  /**
   * Stops the polling loop.
   */
  stopMonitoring(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    this.isRunning = false;
    logger.info('Email monitoring stopped');
  }

  /**
   * Searches for unread confirmation emails matching known patterns.
   * Returns an array of parsed confirmation records with extracted URLs.
   */
  async checkForConfirmations(): Promise<ConfirmationEmail[]> {
    const confirmations: ConfirmationEmail[] = [];

    try {
      const messages = await this.gmailClient.listMessages(
        'is:unread category:primary',
        50,
      );

      for (const message of messages) {
        if (this.processedEmailIds.has(message.id)) {
          continue;
        }

        if (!this.matchesConfirmationPattern(message.subject)) {
          continue;
        }

        const confirmationUrl = this.findConfirmationUrl(message);
        if (!confirmationUrl) {
          logger.debug(
            { emailId: message.id, subject: message.subject },
            'Confirmation email found but no confirmation URL detected',
          );
          continue;
        }

        const confirmation: ConfirmationEmail = {
          emailId: message.id,
          subject: message.subject,
          from: message.from,
          confirmationUrl,
          entryId: this.extractEntryIdFromEmail(message),
        };

        confirmations.push(confirmation);
        this.processedEmailIds.add(message.id);

        logger.info(
          {
            emailId: message.id,
            subject: message.subject,
            from: message.from,
          },
          'Confirmation email detected',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, `Failed to check for confirmations: ${message}`);
    }

    return confirmations;
  }

  /**
   * Searches for unread win notification emails matching known patterns.
   * Returns an array of parsed win records.
   */
  async checkForWins(): Promise<WinEmail[]> {
    const wins: WinEmail[] = [];

    try {
      const messages = await this.gmailClient.listMessages(
        'is:unread category:primary',
        50,
      );

      for (const message of messages) {
        if (this.processedEmailIds.has(message.id)) {
          continue;
        }

        if (!this.matchesWinPattern(message.subject)) {
          continue;
        }

        const claimUrl = this.findClaimUrl(message);
        const prizeDetails = this.extractPrizeInfo(message);

        const winEmail: WinEmail = {
          emailId: message.id,
          subject: message.subject,
          from: message.from,
          prizeDetails: prizeDetails || message.snippet,
          claimUrl: claimUrl || '',
          claimDeadline: this.extractDeadline(message),
        };

        wins.push(winEmail);
        this.processedEmailIds.add(message.id);

        logger.info(
          {
            emailId: message.id,
            subject: message.subject,
            from: message.from,
            prizeDetails,
          },
          'Win notification email detected',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, `Failed to check for wins: ${message}`);
    }

    return wins;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async pollOnce(): Promise<void> {
    logger.debug('Polling for new emails');

    try {
      const confirmations = await this.checkForConfirmations();
      const wins = await this.checkForWins();

      for (const confirmation of confirmations) {
        eventBus.emit('email:confirmed', {
          entryId: confirmation.entryId ?? '',
          emailId: confirmation.emailId,
        });
      }

      for (const win of wins) {
        eventBus.emit('win:detected', {
          entryId: '',
          prizeValue: 0,
          prizeDescription: win.prizeDetails,
        });
      }

      if (confirmations.length > 0 || wins.length > 0) {
        logger.info(
          { confirmations: confirmations.length, wins: wins.length },
          'Poll results',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, `Poll failed: ${message}`);
    }
  }

  private matchesConfirmationPattern(subject: string): boolean {
    return CONFIRMATION_SUBJECT_PATTERNS.some((pattern) =>
      pattern.test(subject),
    );
  }

  private matchesWinPattern(subject: string): boolean {
    return WIN_SUBJECT_PATTERNS.some((pattern) => pattern.test(subject));
  }

  private findConfirmationUrl(message: GmailMessage): string | null {
    const body = message.htmlBody || message.body;
    const links = this.gmailClient.extractLinks(body);

    // Prefer links whose URL path or text contains confirmation keywords
    for (const link of links) {
      if (CONFIRMATION_URL_PATTERNS.some((p) => p.test(link))) {
        return link;
      }
    }

    // Fall back to the first non-unsubscribe link
    for (const link of links) {
      if (!/unsubscribe/i.test(link) && !/opt-?out/i.test(link)) {
        return link;
      }
    }

    return null;
  }

  private findClaimUrl(message: GmailMessage): string | null {
    const body = message.htmlBody || message.body;
    const links = this.gmailClient.extractLinks(body);

    const claimPatterns = [/claim/i, /prize/i, /winner/i, /redeem/i, /collect/i];

    for (const link of links) {
      if (claimPatterns.some((p) => p.test(link))) {
        return link;
      }
    }

    return links[0] ?? null;
  }

  private extractPrizeInfo(message: GmailMessage): string {
    const body = message.body || message.htmlBody;

    // Try to find dollar amounts
    const dollarMatch = body.match(/\$[\d,]+(?:\.\d{2})?/);
    if (dollarMatch) {
      return dollarMatch[0];
    }

    // Try to find prize description near "prize" or "win"
    const prizeMatch = body.match(
      /(?:prize|won|win|reward)[:\s]+([^\n.!]{5,100})/i,
    );
    if (prizeMatch?.[1]) {
      return prizeMatch[1].trim();
    }

    return '';
  }

  private extractDeadline(message: GmailMessage): string | undefined {
    const body = message.body || message.htmlBody;

    // Match dates near "deadline", "by", "before", "expires", "must claim"
    const deadlineMatch = body.match(
      /(?:deadline|by|before|expires?|must claim)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i,
    );
    if (deadlineMatch?.[1]) {
      return deadlineMatch[1].trim();
    }

    return undefined;
  }

  private extractEntryIdFromEmail(message: GmailMessage): string | undefined {
    const body = message.body || message.htmlBody;

    // Look for entry IDs or reference numbers
    const entryMatch = body.match(
      /(?:entry|reference|confirmation|id)[:\s#]+([A-Z0-9]{10,30})/i,
    );
    return entryMatch?.[1] ?? undefined;
  }
}
