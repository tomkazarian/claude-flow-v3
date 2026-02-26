/**
 * Email notification channel for win alerts and important notifications.
 * Uses nodemailer for SMTP delivery with HTML and plain-text fallback.
 */

import { getLogger } from '../../shared/logger.js';
import { retry } from '../../shared/retry.js';
import type {
  AppNotification,
  NotificationChannel,
  SmtpConfig,
  WinData,
} from '../types.js';

const log = getLogger('notification', { channel: 'email' });

// ---------------------------------------------------------------------------
// HTML template helpers
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function priorityColorHex(priority: AppNotification['priority']): string {
  switch (priority) {
    case 'urgent': return '#ff0000';
    case 'high': return '#ff9900';
    case 'normal': return '#36a64f';
    case 'low': return '#999999';
  }
}

function buildWinHtml(notification: AppNotification): string {
  const winData = notification.data as unknown as WinData | undefined;
  const color = priorityColorHex(notification.priority);
  const timestamp = notification.timestamp ?? new Date().toISOString();

  let prizeSection = '';
  if (winData) {
    const prizeValue = winData.prizeValue != null
      ? `$${winData.prizeValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : 'Not specified';

    prizeSection = `
    <table cellpadding="8" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr>
        <td style="background:#f8f9fa;border:1px solid #dee2e6;font-weight:bold;width:140px;">Prize</td>
        <td style="border:1px solid #dee2e6;">${escapeHtml(winData.prizeDescription)}</td>
      </tr>
      <tr>
        <td style="background:#f8f9fa;border:1px solid #dee2e6;font-weight:bold;">Estimated Value</td>
        <td style="border:1px solid #dee2e6;">${escapeHtml(prizeValue)}</td>
      </tr>
      <tr>
        <td style="background:#f8f9fa;border:1px solid #dee2e6;font-weight:bold;">Contest</td>
        <td style="border:1px solid #dee2e6;">${escapeHtml(winData.contestTitle)}</td>
      </tr>
      <tr>
        <td style="background:#f8f9fa;border:1px solid #dee2e6;font-weight:bold;">Profile</td>
        <td style="border:1px solid #dee2e6;">${escapeHtml(winData.profileName)}</td>
      </tr>
      ${winData.claimDeadline ? `
      <tr>
        <td style="background:#f8f9fa;border:1px solid #dee2e6;font-weight:bold;">Claim Deadline</td>
        <td style="border:1px solid #dee2e6;color:#cc0000;font-weight:bold;">${escapeHtml(winData.claimDeadline)}</td>
      </tr>` : ''}
    </table>
    ${winData.claimUrl ? `
    <p style="text-align:center;margin:24px 0;">
      <a href="${escapeHtml(winData.claimUrl)}"
         style="background:#28a745;color:#ffffff;padding:12px 32px;text-decoration:none;border-radius:4px;font-weight:bold;display:inline-block;">
        Claim Your Prize
      </a>
    </p>` : ''}`;
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;">
  <table cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background:#ffffff;">
    <tr>
      <td style="background:${color};padding:20px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;">${escapeHtml(notification.title)}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        <p style="font-size:16px;line-height:1.5;color:#333333;">
          ${escapeHtml(notification.message).replace(/\n/g, '<br>')}
        </p>
        ${prizeSection}
      </td>
    </tr>
    <tr>
      <td style="background:#f8f9fa;padding:12px 24px;text-align:center;font-size:12px;color:#666666;">
        Sweepstakes Platform Notification | ${escapeHtml(timestamp)}
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildGenericHtml(notification: AppNotification): string {
  const color = priorityColorHex(notification.priority);
  const timestamp = notification.timestamp ?? new Date().toISOString();

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;">
  <table cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background:#ffffff;">
    <tr>
      <td style="background:${color};padding:20px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;">${escapeHtml(notification.title)}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        <p style="font-size:14px;color:#666;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">
          ${escapeHtml(notification.type)} | ${escapeHtml(notification.priority)} priority
        </p>
        <p style="font-size:16px;line-height:1.5;color:#333333;">
          ${escapeHtml(notification.message).replace(/\n/g, '<br>')}
        </p>
      </td>
    </tr>
    <tr>
      <td style="background:#f8f9fa;padding:12px 24px;text-align:center;font-size:12px;color:#666666;">
        Sweepstakes Platform Notification | ${escapeHtml(timestamp)}
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildPlainText(notification: AppNotification): string {
  const lines = [
    `=== ${notification.title} ===`,
    '',
    `Type: ${notification.type}`,
    `Priority: ${notification.priority}`,
    '',
    notification.message,
    '',
  ];

  if (notification.type === 'win' && notification.data) {
    const winData = notification.data as unknown as WinData;
    lines.push('--- Prize Details ---');
    lines.push(`Prize: ${winData.prizeDescription}`);
    if (winData.prizeValue != null) {
      lines.push(`Value: $${winData.prizeValue.toFixed(2)}`);
    }
    lines.push(`Contest: ${winData.contestTitle}`);
    lines.push(`Profile: ${winData.profileName}`);
    if (winData.claimDeadline) {
      lines.push(`Claim Deadline: ${winData.claimDeadline}`);
    }
    if (winData.claimUrl) {
      lines.push(`Claim URL: ${winData.claimUrl}`);
    }
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`Sweepstakes Platform | ${notification.timestamp ?? new Date().toISOString()}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Email channel
// ---------------------------------------------------------------------------

export class EmailAlertChannel implements NotificationChannel {
  readonly name = 'email';
  private readonly smtpConfig: SmtpConfig | undefined;
  private readonly recipients: string[];

  constructor(recipients: string[], smtpConfig?: SmtpConfig) {
    this.recipients = recipients.filter((r) => r.length > 0);
    this.smtpConfig = smtpConfig;
  }

  /**
   * Sends a notification email to all configured recipients.
   * Returns true if all emails were sent successfully.
   */
  async send(notification: AppNotification): Promise<boolean> {
    if (this.recipients.length === 0) {
      log.debug('No email recipients configured, skipping');
      return false;
    }

    if (!this.smtpConfig) {
      log.warn('SMTP not configured, cannot send email notifications');
      return false;
    }

    const html =
      notification.type === 'win'
        ? buildWinHtml(notification)
        : buildGenericHtml(notification);
    const text = buildPlainText(notification);

    const subject = `[Sweepstakes] ${notification.title}`;

    const results = await Promise.allSettled(
      this.recipients.map((recipient) =>
        this.sendEmail(recipient, subject, html, text),
      ),
    );

    const successes = results.filter((r) => r.status === 'fulfilled' && r.value === true);
    const failures = results.filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === false),
    );

    if (failures.length > 0) {
      log.warn(
        { successes: successes.length, failures: failures.length },
        'Some email deliveries failed',
      );
    }

    return successes.length > 0;
  }

  /**
   * Sends a single email via SMTP with retry logic.
   */
  private async sendEmail(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<boolean> {
    const config = this.smtpConfig;
    if (!config) {
      return false;
    }

    return retry(
      async () => {
        // Dynamic import to avoid requiring nodemailer at module load time
        // when email is not configured.
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: {
            user: config.auth.user,
            pass: config.auth.pass,
          },
        });

        const info = await transporter.sendMail({
          from: config.from,
          to,
          subject,
          html,
          text,
        });

        log.info(
          { to, messageId: info.messageId },
          'Email notification sent',
        );
        return true;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        maxDelayMs: 10_000,
        backoffMultiplier: 2,
        onRetry: (error, attempt, delayMs) => {
          log.warn(
            { to, attempt, delayMs, error: error.message },
            'Retrying email delivery',
          );
        },
      },
    );
  }
}
