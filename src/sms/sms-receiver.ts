/**
 * Receives and manages SMS messages for verification code extraction.
 *
 * Polls an SMS provider for incoming messages on a given phone number,
 * extracts verification codes, and emits events when codes are found.
 */

import { getLogger } from '../shared/logger.js';
import { SmsError } from '../shared/errors.js';
import { eventBus } from '../shared/events.js';
import { DEFAULT_LIMITS } from '../shared/constants.js';
import { sleep } from '../shared/timing.js';
import { extractCode } from './code-extractor.js';

const logger = getLogger('sms', { component: 'sms-receiver' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmsMessage {
  from: string;
  to: string;
  body: string;
  receivedAt: string;
}

/**
 * Provider interface that all SMS providers must implement.
 * This allows SmsReceiver to work with any provider (Twilio, etc.).
 */
export interface SmsProvider {
  getMessages(phoneNumber: string, since?: Date): Promise<SmsMessage[]>;
}

// ---------------------------------------------------------------------------
// SmsReceiver
// ---------------------------------------------------------------------------

export class SmsReceiver {
  private readonly provider: SmsProvider;

  constructor(provider: SmsProvider) {
    this.provider = provider;
  }

  /**
   * Polls for an incoming SMS verification code on the given phone number.
   * Returns the extracted code when found, or throws if the timeout elapses.
   *
   * @param phoneNumber - The phone number to monitor for incoming SMS
   * @param timeoutMs - Maximum time to wait for a code (default: 180s)
   * @returns The extracted verification code string
   * @throws {SmsError} If no code is received within the timeout
   */
  async waitForCode(
    phoneNumber: string,
    timeoutMs = DEFAULT_LIMITS.SMS_POLL_TIMEOUT_MS,
  ): Promise<string> {
    const pollInterval = DEFAULT_LIMITS.SMS_POLL_INTERVAL_MS;
    const startTime = Date.now();
    const since = new Date();

    logger.info(
      { phoneNumber, timeoutMs, pollInterval },
      'Waiting for SMS verification code',
    );

    while (Date.now() - startTime < timeoutMs) {
      try {
        const messages = await this.provider.getMessages(phoneNumber, since);

        for (const message of messages) {
          const code = extractCode(message.body);
          if (code) {
            logger.info(
              {
                phoneNumber,
                from: message.from,
                codeLength: code.length,
                elapsedMs: Date.now() - startTime,
              },
              'Verification code extracted from SMS',
            );

            eventBus.emit('sms:received', {
              phoneNumber,
              code,
            });

            return code;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { phoneNumber, err: error },
          `SMS poll error (will retry): ${message}`,
        );
      }

      await sleep(pollInterval);
    }

    const elapsed = Date.now() - startTime;
    logger.error(
      { phoneNumber, timeoutMs, elapsedMs: elapsed },
      'Timed out waiting for SMS verification code',
    );

    throw new SmsError(
      `No verification code received within ${timeoutMs}ms`,
      'SMS_TIMEOUT',
      phoneNumber,
    );
  }

  /**
   * Retrieves the most recent SMS messages for a phone number.
   *
   * @param phoneNumber - The phone number to query
   * @param limit - Maximum number of messages to return (default: 10)
   */
  async getRecentMessages(
    phoneNumber: string,
    limit = 10,
  ): Promise<SmsMessage[]> {
    try {
      const messages = await this.provider.getMessages(phoneNumber);

      const sorted = messages.sort(
        (a, b) =>
          new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
      );

      return sorted.slice(0, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { phoneNumber, err: error },
        `Failed to get recent messages: ${message}`,
      );
      throw new SmsError(
        `Failed to retrieve messages: ${message}`,
        'SMS_FETCH_FAILED',
        phoneNumber,
      );
    }
  }
}
