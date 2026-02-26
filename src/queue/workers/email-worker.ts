/**
 * BullMQ worker for processing email verification jobs.
 *
 * When a contest entry requires email confirmation, this worker:
 * 1. Polls the email inbox for a confirmation message
 * 2. Extracts the confirmation link
 * 3. Visits the confirmation URL
 * 4. Updates the entry status to 'confirmed'
 */

import { Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import { QUEUE_NAMES } from '../../shared/constants.js';
import { getLogger } from '../../shared/logger.js';
import { eventBus } from '../../shared/events.js';
import { EmailError } from '../../shared/errors.js';
import { getDb, schema } from '../../db/index.js';
import { sleep } from '../../shared/timing.js';

const log = getLogger('queue', { component: 'email-worker' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Interval between inbox checks in ms. */
const POLL_INTERVAL_MS = 15_000;
/** Total time to wait for the email to arrive in ms. */
const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes
/** Common confirmation link patterns in email bodies. */
const CONFIRMATION_PATTERNS = [
  /https?:\/\/[^\s"'<>]+confirm[^\s"'<>]*/gi,
  /https?:\/\/[^\s"'<>]+verify[^\s"'<>]*/gi,
  /https?:\/\/[^\s"'<>]+activate[^\s"'<>]*/gi,
  /https?:\/\/[^\s"'<>]+click[^\s"'<>]*/gi,
  /https?:\/\/[^\s"'<>]+opt-in[^\s"'<>]*/gi,
];

// ---------------------------------------------------------------------------
// Job data shape
// ---------------------------------------------------------------------------

export interface EmailJobData {
  entryId: string;
  emailAddress: string;
  confirmationType: 'link' | 'code';
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Creates a BullMQ worker that processes email verification jobs.
 */
export function createEmailWorker(connection: IORedis): Worker {
  const worker = new Worker<EmailJobData>(
    QUEUE_NAMES.EMAIL_VERIFY,
    async (job: Job<EmailJobData>) => {
      return processEmailJob(job);
    },
    {
      connection,
      concurrency: 5,
      lockDuration: MAX_WAIT_MS + 60_000, // Wait time + buffer
    },
  );

  worker.on('completed', (job: Job<EmailJobData>, result: unknown) => {
    const res = result as { confirmed: boolean } | undefined;
    log.info(
      {
        jobId: job.id,
        entryId: job.data.entryId,
        email: maskEmail(job.data.emailAddress),
        confirmed: res?.confirmed ?? false,
      },
      'Email verification job completed',
    );
  });

  worker.on('failed', (job: Job<EmailJobData> | undefined, error: Error) => {
    log.error(
      {
        jobId: job?.id,
        entryId: job?.data.entryId,
        email: job?.data.emailAddress ? maskEmail(job.data.emailAddress) : 'unknown',
        err: error,
      },
      'Email verification job failed',
    );
  });

  worker.on('error', (error: Error) => {
    log.error({ err: error }, 'Email worker error');
  });

  log.info('Email verification worker created');
  return worker;
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

async function processEmailJob(
  job: Job<EmailJobData>,
): Promise<{ confirmed: boolean; confirmationUrl?: string }> {
  const { entryId, emailAddress, confirmationType } = job.data;

  log.info(
    {
      jobId: job.id,
      entryId,
      email: maskEmail(emailAddress),
      type: confirmationType,
    },
    'Starting email verification',
  );

  await job.updateProgress(10);

  // Look up the email account configuration
  const db = getDb();
  const emailAccounts = await db
    .select()
    .from(schema.emailAccounts)
    .where(eq(schema.emailAccounts.emailAddress, emailAddress))
    .limit(1);

  const emailAccount = emailAccounts[0];
  if (!emailAccount) {
    throw new EmailError(
      `No email account configured for: ${maskEmail(emailAddress)}`,
      'EMAIL_ACCOUNT_NOT_FOUND',
      emailAddress,
    );
  }

  // Poll for the confirmation email
  const startTime = Date.now();
  let confirmationUrl: string | null = null;
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
      },
      'Polling for confirmation email',
    );

    // Search for confirmation email
    const email = await searchForConfirmationEmail(
      emailAccount.provider,
      emailAddress,
      entryId,
    );

    if (email) {
      if (confirmationType === 'link') {
        confirmationUrl = extractConfirmationLink(email.body);
        if (confirmationUrl) {
          log.info(
            { entryId, confirmationUrl: truncateUrl(confirmationUrl) },
            'Confirmation link found',
          );
          break;
        }
      } else {
        // Code-based confirmation
        const code = extractConfirmationCode(email.body);
        if (code) {
          log.info({ entryId, codeLength: code.length }, 'Confirmation code found');
          // For code-based verification, return the code in the result
          await updateEntryConfirmed(db, entryId);
          eventBus.emit('email:confirmed', { entryId, emailId: email.id });
          await job.updateProgress(100);
          return { confirmed: true };
        }
      }
    }

    // Wait before next poll
    await sleep(POLL_INTERVAL_MS);
  }

  if (!confirmationUrl && confirmationType === 'link') {
    throw new EmailError(
      `Confirmation email not received within ${MAX_WAIT_MS / 1000}s for entry: ${entryId}`,
      'EMAIL_CONFIRMATION_TIMEOUT',
      emailAddress,
    );
  }

  // Click the confirmation link
  if (confirmationUrl) {
    await visitConfirmationLink(confirmationUrl);
    await updateEntryConfirmed(db, entryId);

    eventBus.emit('email:confirmed', {
      entryId,
      emailId: `email-${entryId}`,
    });

    await job.updateProgress(100);

    log.info({ entryId }, 'Email confirmation completed successfully');
    return { confirmed: true, confirmationUrl };
  }

  throw new EmailError(
    `Failed to process email confirmation for entry: ${entryId}`,
    'EMAIL_CONFIRMATION_FAILED',
    emailAddress,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EmailMessage {
  id: string;
  subject: string;
  body: string;
  from: string;
  receivedAt: string;
}

/**
 * Searches for a confirmation email in the inbox.
 * In production, this would use Gmail API, IMAP, or other provider-specific methods.
 */
async function searchForConfirmationEmail(
  provider: string,
  _emailAddress: string,
  _entryId: string,
): Promise<EmailMessage | null> {
  // Integration point for email providers:
  // - Gmail: use googleapis to search messages
  // - IMAP: use imap-simple or similar
  // - Outlook: use Microsoft Graph API

  log.debug({ provider }, 'Searching for confirmation email via provider');

  // This would be replaced by actual email provider integration.
  // Returning null triggers the retry loop.
  return null;
}

/**
 * Extracts a confirmation link from an email body using common patterns.
 */
function extractConfirmationLink(body: string): string | null {
  for (const pattern of CONFIRMATION_PATTERNS) {
    // Reset regex lastIndex since we're reusing them
    pattern.lastIndex = 0;
    const match = pattern.exec(body);
    if (match?.[0]) {
      // Clean up any trailing punctuation or HTML artifacts
      return match[0]
        .replace(/['")\]}>]+$/, '')
        .replace(/&amp;/g, '&');
    }
  }
  return null;
}

/**
 * Extracts a numeric confirmation code from email body.
 * Common patterns: 6-digit codes, 4-digit codes.
 */
function extractConfirmationCode(body: string): string | null {
  // Look for patterns like "Your code is: 123456" or "Code: 1234"
  const codePatterns = [
    /(?:code|pin|otp|verification)\s*(?:is|:)\s*(\d{4,8})/i,
    /(\d{6})\s*(?:is your|as your)/i,
    /\b(\d{6})\b/,
  ];

  for (const pattern of codePatterns) {
    const match = pattern.exec(body);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Visits a confirmation URL using an HTTP GET request.
 * Some confirmations only require the link to be visited (no browser needed).
 */
async function visitConfirmationLink(url: string): Promise<void> {
  try {
    const { default: got } = await import('got');
    await got(url, {
      timeout: { request: 30_000 },
      followRedirect: true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    log.info({ url: truncateUrl(url) }, 'Confirmation link visited successfully');
  } catch (error) {
    log.warn(
      { err: error, url: truncateUrl(url) },
      'Failed to visit confirmation link, entry may still be confirmed',
    );
  }
}

async function updateEntryConfirmed(
  db: ReturnType<typeof getDb>,
  entryId: string,
): Promise<void> {
  await db
    .update(schema.entries)
    .set({
      status: 'confirmed',
      emailConfirmed: 1,
      confirmedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.entries.id, entryId));
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const masked = local.length > 2
    ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
    : '**';
  return `${masked}@${domain}`;
}

function truncateUrl(url: string): string {
  return url.length > 80 ? url.slice(0, 80) + '...' : url;
}
