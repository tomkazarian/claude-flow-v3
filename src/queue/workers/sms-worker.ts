/**
 * BullMQ worker for processing SMS verification jobs.
 *
 * When a contest entry requires SMS verification, this worker:
 * 1. Waits for an incoming SMS with a verification code
 * 2. Extracts the code from the message
 * 3. Returns the code for the entry orchestrator to submit
 * 4. Updates the entry status
 */

import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import { QUEUE_NAMES } from '../../shared/constants.js';
import { getLogger } from '../../shared/logger.js';
import { eventBus } from '../../shared/events.js';
import { SmsError } from '../../shared/errors.js';
import { getDb, schema } from '../../db/index.js';
import { sleep } from '../../shared/timing.js';

const log = getLogger('queue', { component: 'sms-worker' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Interval between SMS inbox checks in ms. */
const POLL_INTERVAL_MS = 5_000;
/** Total time to wait for the SMS to arrive in ms. */
const MAX_WAIT_MS = 2 * 60 * 1000; // 2 minutes
/** Patterns for extracting verification codes from SMS messages. */
const CODE_PATTERNS = [
  /(?:code|pin|otp|verification)\s*(?:is|:)\s*(\d{4,8})/i,
  /(\d{6})\s*(?:is your|as your)/i,
  /\b(\d{4,8})\b/,
];

// ---------------------------------------------------------------------------
// Job data shape
// ---------------------------------------------------------------------------

export interface SmsJobData {
  entryId: string;
  phoneNumber: string;
  provider: string;
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Creates a BullMQ worker that processes SMS verification jobs.
 */
export function createSmsWorker(connection: IORedis): Worker {
  const worker = new Worker<SmsJobData>(
    QUEUE_NAMES.SMS_VERIFY,
    async (job: Job<SmsJobData>) => {
      return processSmsJob(job);
    },
    {
      connection,
      concurrency: 3,
      lockDuration: MAX_WAIT_MS + 30_000, // Wait time + buffer
    },
  );

  worker.on('completed', (job: Job<SmsJobData>, result: unknown) => {
    const res = result as { verified: boolean; code?: string } | undefined;
    log.info(
      {
        jobId: job.id,
        entryId: job.data.entryId,
        phone: maskPhone(job.data.phoneNumber),
        verified: res?.verified ?? false,
      },
      'SMS verification job completed',
    );
  });

  worker.on('failed', (job: Job<SmsJobData> | undefined, error: Error) => {
    log.error(
      {
        jobId: job?.id,
        entryId: job?.data.entryId,
        phone: job?.data.phoneNumber ? maskPhone(job.data.phoneNumber) : 'unknown',
        err: error,
      },
      'SMS verification job failed',
    );
  });

  worker.on('error', (error: Error) => {
    log.error({ err: error }, 'SMS worker error');
  });

  log.info('SMS verification worker created');
  return worker;
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

async function processSmsJob(
  job: Job<SmsJobData>,
): Promise<{ verified: boolean; code?: string }> {
  const { entryId, phoneNumber, provider } = job.data;

  log.info(
    {
      jobId: job.id,
      entryId,
      phone: maskPhone(phoneNumber),
      provider,
    },
    'Starting SMS verification',
  );

  await job.updateProgress(10);

  // Look up the SMS number configuration
  const db = getDb();
  const smsNumbers = await db
    .select()
    .from(schema.smsNumbers)
    .where(eq(schema.smsNumbers.phoneNumber, phoneNumber))
    .limit(1);

  const smsNumber = smsNumbers[0];
  if (!smsNumber) {
    throw new SmsError(
      `No SMS number configured for: ${maskPhone(phoneNumber)}`,
      'SMS_NUMBER_NOT_FOUND',
      phoneNumber,
    );
  }

  if (!smsNumber.isActive) {
    throw new SmsError(
      `SMS number is inactive: ${maskPhone(phoneNumber)}`,
      'SMS_NUMBER_INACTIVE',
      phoneNumber,
    );
  }

  // Poll for the verification SMS
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < MAX_WAIT_MS) {
    attempts += 1;
    const elapsed = Date.now() - startTime;
    const progress = Math.min(80, 10 + Math.round((elapsed / MAX_WAIT_MS) * 70));
    await job.updateProgress(progress);

    log.debug(
      {
        entryId,
        attempt: attempts,
        elapsedMs: elapsed,
        phone: maskPhone(phoneNumber),
      },
      'Polling for verification SMS',
    );

    // Check for incoming SMS
    const smsMessage = await checkForSms(provider, phoneNumber, startTime);

    if (smsMessage) {
      const code = extractCode(smsMessage.body);

      if (code) {
        log.info(
          {
            entryId,
            codeLength: code.length,
            phone: maskPhone(phoneNumber),
          },
          'Verification code extracted from SMS',
        );

        // Update entry record
        await db
          .update(schema.entries)
          .set({
            smsVerified: 1,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.entries.id, entryId));

        // Update SMS number last message timestamp
        await db
          .update(schema.smsNumbers)
          .set({
            lastMessageAt: new Date().toISOString(),
          })
          .where(eq(schema.smsNumbers.id, smsNumber.id));

        eventBus.emit('sms:received', { phoneNumber, code });
        await job.updateProgress(100);

        return { verified: true, code };
      }

      log.debug(
        { entryId, messageBody: smsMessage.body.slice(0, 100) },
        'SMS received but no code found, continuing to poll',
      );
    }

    // Wait before next poll
    await sleep(POLL_INTERVAL_MS);
  }

  // Timeout: no SMS received
  throw new SmsError(
    `SMS verification code not received within ${MAX_WAIT_MS / 1000}s for entry: ${entryId}`,
    'SMS_VERIFICATION_TIMEOUT',
    phoneNumber,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SmsMessage {
  id: string;
  from: string;
  body: string;
  receivedAt: string;
}

/**
 * Checks for incoming SMS messages on the configured provider.
 * Uses real provider SDKs (Twilio, etc.) to fetch recent messages.
 * Returns null if no matching message is found (the caller retries).
 */
async function checkForSms(
  provider: string,
  phoneNumber: string,
  since: number,
): Promise<SmsMessage | null> {
  log.debug({ provider, phone: maskPhone(phoneNumber) }, 'Checking SMS inbox via provider');

  try {
    if (provider === 'twilio') {
      return await checkTwilioInbox(phoneNumber, since);
    }

    log.warn({ provider }, 'Unknown SMS provider, cannot check inbox');
    return null;
  } catch (error) {
    log.warn(
      { err: error, provider, phone: maskPhone(phoneNumber) },
      'Error checking SMS inbox, will retry',
    );
    return null;
  }
}

/**
 * Checks the Twilio inbox for recent inbound SMS messages
 * using the real Twilio SDK.
 */
async function checkTwilioInbox(
  phoneNumber: string,
  since: number,
): Promise<SmsMessage | null> {
  const accountSid = process.env['TWILIO_ACCOUNT_SID'];
  const authToken = process.env['TWILIO_AUTH_TOKEN'];

  if (!accountSid || !authToken) {
    log.debug('Twilio credentials not configured, cannot check SMS inbox');
    return null;
  }

  try {
    const { TwilioProvider } = await import('../../sms/providers/twilio.js');
    const twilioProvider = new TwilioProvider({
      accountSid,
      authToken,
    });

    const sinceDate = new Date(since);
    const messages = await twilioProvider.getMessages(phoneNumber, sinceDate);

    if (messages.length > 0) {
      // Return the most recent inbound message
      const latest = messages[0]!;
      return {
        id: `twilio-${Date.now()}`,
        from: latest.from,
        body: latest.body,
        receivedAt: latest.receivedAt,
      };
    }

    return null;
  } catch (error) {
    log.debug({ err: error }, 'Twilio inbox check failed');
    return null;
  }
}

/**
 * Extracts a numeric verification code from an SMS message body.
 */
function extractCode(body: string): string | null {
  for (const pattern of CODE_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(body);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Masks a phone number for safe logging.
 * Example: "+15551234567" -> "+1555***4567"
 */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, 4) + '***' + phone.slice(-4);
}
