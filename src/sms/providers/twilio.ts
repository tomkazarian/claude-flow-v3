/**
 * Twilio SMS provider integration.
 *
 * Manages phone number provisioning, message retrieval, and number
 * lifecycle using the Twilio REST API via the official SDK.
 */

import Twilio from 'twilio';
import { getLogger } from '../../shared/logger.js';
import { SmsError } from '../../shared/errors.js';
import { retry } from '../../shared/retry.js';
import type { SmsMessage, SmsProvider } from '../sms-receiver.js';

const logger = getLogger('sms', { component: 'twilio-provider' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
}

export interface PhoneNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  capabilities: {
    sms: boolean;
    voice: boolean;
    mms: boolean;
  };
}

// ---------------------------------------------------------------------------
// TwilioProvider
// ---------------------------------------------------------------------------

export class TwilioProvider implements SmsProvider {
  private readonly client: ReturnType<typeof Twilio>;

  constructor(config: TwilioConfig) {
    if (!config.accountSid || !config.authToken) {
      throw new SmsError(
        'Twilio accountSid and authToken are required',
        'TWILIO_CONFIG_MISSING',
        '',
      );
    }

    this.client = Twilio(config.accountSid, config.authToken);
    logger.info('TwilioProvider initialized');
  }

  /**
   * Lists all phone numbers owned by the Twilio account.
   */
  async getNumbers(): Promise<PhoneNumber[]> {
    try {
      const numbers = await retry(
        async () => {
          const incoming =
            await this.client.incomingPhoneNumbers.list({ limit: 100 });
          return incoming;
        },
        {
          maxAttempts: 3,
          retryableErrors: ['ECONNRESET', 'ETIMEDOUT', '429'],
        },
      );

      return numbers.map((n) => ({
        sid: n.sid,
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        capabilities: {
          sms: n.capabilities?.sms ?? false,
          voice: n.capabilities?.voice ?? false,
          mms: n.capabilities?.mms ?? false,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, `Failed to list Twilio numbers: ${message}`);
      throw new SmsError(
        `Failed to list phone numbers: ${message}`,
        'TWILIO_LIST_FAILED',
        '',
      );
    }
  }

  /**
   * Provisions (purchases) a new phone number from Twilio.
   * Optionally filters by area code for geographic targeting.
   */
  async provisionNumber(areaCode?: string): Promise<PhoneNumber> {
    try {
      // Search for available numbers
      const searchParams: Record<string, unknown> = {
        smsEnabled: true,
        limit: 1,
      };

      if (areaCode) {
        searchParams.areaCode = areaCode;
      }

      const available = await retry(
        () =>
          this.client
            .availablePhoneNumbers('US')
            .local.list(searchParams),
        {
          maxAttempts: 3,
          retryableErrors: ['ECONNRESET', 'ETIMEDOUT', '429'],
        },
      );

      if (available.length === 0) {
        throw new SmsError(
          `No available numbers found${areaCode ? ` for area code ${areaCode}` : ''}`,
          'TWILIO_NO_NUMBERS',
          '',
        );
      }

      const selectedNumber = available[0]!;

      // Purchase the number
      const purchased = await retry(
        () =>
          this.client.incomingPhoneNumbers.create({
            phoneNumber: selectedNumber.phoneNumber,
          }),
        {
          maxAttempts: 2,
          retryableErrors: ['ECONNRESET', 'ETIMEDOUT'],
        },
      );

      const result: PhoneNumber = {
        sid: purchased.sid,
        phoneNumber: purchased.phoneNumber,
        friendlyName: purchased.friendlyName,
        capabilities: {
          sms: purchased.capabilities?.sms ?? false,
          voice: purchased.capabilities?.voice ?? false,
          mms: purchased.capabilities?.mms ?? false,
        },
      };

      logger.info(
        { phoneNumber: result.phoneNumber, sid: result.sid },
        'Phone number provisioned',
      );

      return result;
    } catch (error) {
      if (error instanceof SmsError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error, areaCode }, `Failed to provision number: ${message}`);
      throw new SmsError(
        `Failed to provision number: ${message}`,
        'TWILIO_PROVISION_FAILED',
        '',
      );
    }
  }

  /**
   * Releases (deletes) a phone number from the Twilio account.
   */
  async releaseNumber(phoneNumber: string): Promise<void> {
    try {
      // Find the SID for this phone number
      const numbers = await this.client.incomingPhoneNumbers.list({
        phoneNumber,
        limit: 1,
      });

      if (numbers.length === 0) {
        throw new SmsError(
          `Phone number ${phoneNumber} not found in account`,
          'TWILIO_NUMBER_NOT_FOUND',
          phoneNumber,
        );
      }

      const sid = numbers[0]!.sid;
      await this.client.incomingPhoneNumbers(sid).remove();

      logger.info({ phoneNumber, sid }, 'Phone number released');
    } catch (error) {
      if (error instanceof SmsError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { phoneNumber, err: error },
        `Failed to release number: ${message}`,
      );
      throw new SmsError(
        `Failed to release number: ${message}`,
        'TWILIO_RELEASE_FAILED',
        phoneNumber,
      );
    }
  }

  /**
   * Fetches recent incoming SMS messages for a phone number.
   * Implements the SmsProvider interface.
   *
   * @param phoneNumber - The Twilio number that received messages
   * @param since - Only return messages received after this date
   */
  async getMessages(
    phoneNumber: string,
    since?: Date,
  ): Promise<SmsMessage[]> {
    try {
      const listParams: Record<string, unknown> = {
        to: phoneNumber,
        limit: 20,
      };

      if (since) {
        listParams.dateSentAfter = since;
      }

      const twilioMessages = await retry(
        () => this.client.messages.list(listParams),
        {
          maxAttempts: 3,
          retryableErrors: ['ECONNRESET', 'ETIMEDOUT', '429'],
        },
      );

      return twilioMessages
        .filter((m) => m.direction === 'inbound')
        .map((m) => ({
          from: m.from ?? '',
          to: m.to ?? phoneNumber,
          body: m.body ?? '',
          receivedAt: m.dateSent?.toISOString() ?? new Date().toISOString(),
        }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { phoneNumber, err: error },
        `Failed to fetch messages: ${message}`,
      );
      throw new SmsError(
        `Failed to fetch messages: ${message}`,
        'TWILIO_FETCH_FAILED',
        phoneNumber,
      );
    }
  }
}
