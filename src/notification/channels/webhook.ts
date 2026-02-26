/**
 * Webhook notification channel.
 * Supports Slack and Discord webhook formats with auto-detection.
 */

import { getLogger } from '../../shared/logger.js';
import { retry } from '../../shared/retry.js';
import type { AppNotification, NotificationChannel, WinData } from '../types.js';

const log = getLogger('notification', { channel: 'webhook' });

type WebhookFormat = 'slack' | 'discord' | 'generic';

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
  elements?: Array<{
    type: string;
    text?: {
      type: string;
      text: string;
    };
    url?: string;
  }>;
}

interface SlackPayload {
  text: string;
  blocks: SlackBlock[];
}

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  timestamp?: string;
  footer?: {
    text: string;
  };
}

interface DiscordPayload {
  content: string;
  embeds: DiscordEmbed[];
}

/**
 * Detects the webhook format based on the URL.
 */
function detectFormat(url: string): WebhookFormat {
  if (url.includes('hooks.slack.com')) {
    return 'slack';
  }
  if (url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks')) {
    return 'discord';
  }
  return 'generic';
}

/**
 * Returns a color code for the notification priority.
 * Discord uses decimal color values; Slack uses hex emoji indicators.
 */
function priorityColor(priority: AppNotification['priority']): number {
  switch (priority) {
    case 'urgent': return 0xff0000; // red
    case 'high': return 0xff9900;   // orange
    case 'normal': return 0x36a64f; // green
    case 'low': return 0x999999;    // gray
  }
}

function priorityEmoji(priority: AppNotification['priority']): string {
  switch (priority) {
    case 'urgent': return ':rotating_light:';
    case 'high': return ':warning:';
    case 'normal': return ':information_source:';
    case 'low': return ':speech_balloon:';
  }
}

/**
 * Formats an AppNotification as a Slack webhook payload.
 */
function formatSlackPayload(notification: AppNotification): SlackPayload {
  const emoji = priorityEmoji(notification.priority);
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: notification.title,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *${notification.type.toUpperCase()}* | Priority: *${notification.priority}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: notification.message,
      },
    },
  ];

  // Add rich fields for win data
  if (notification.type === 'win' && notification.data) {
    const winData = notification.data as unknown as WinData;
    const fields: SlackBlock['fields'] = [];

    if (winData.prizeValue != null) {
      fields.push({
        type: 'mrkdwn',
        text: `*Prize Value:*\n$${winData.prizeValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      });
    }
    if (winData.claimDeadline) {
      fields.push({
        type: 'mrkdwn',
        text: `*Claim Deadline:*\n${winData.claimDeadline}`,
      });
    }

    if (fields.length > 0) {
      blocks.push({ type: 'section', fields });
    }

    if (winData.claimUrl) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Claim Prize',
            },
            url: winData.claimUrl,
          },
        ],
      });
    }
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: {
          type: 'mrkdwn',
          text: `Sweepstakes Platform | ${notification.timestamp ?? new Date().toISOString()}`,
        },
      },
    ],
  });

  return {
    text: `${notification.title}: ${notification.message}`,
    blocks,
  };
}

/**
 * Formats an AppNotification as a Discord webhook payload.
 */
function formatDiscordPayload(notification: AppNotification): DiscordPayload {
  const embed: DiscordEmbed = {
    title: notification.title,
    description: notification.message,
    color: priorityColor(notification.priority),
    timestamp: notification.timestamp ?? new Date().toISOString(),
    footer: {
      text: `Type: ${notification.type} | Priority: ${notification.priority}`,
    },
  };

  // Add rich fields for win data
  if (notification.type === 'win' && notification.data) {
    const winData = notification.data as unknown as WinData;
    const fields: DiscordEmbed['fields'] = [];

    if (winData.prizeValue != null) {
      fields.push({
        name: 'Prize Value',
        value: `$${winData.prizeValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        inline: true,
      });
    }
    if (winData.contestTitle) {
      fields.push({
        name: 'Contest',
        value: winData.contestTitle,
        inline: true,
      });
    }
    if (winData.claimDeadline) {
      fields.push({
        name: 'Claim Deadline',
        value: winData.claimDeadline,
        inline: true,
      });
    }
    if (winData.claimUrl) {
      fields.push({
        name: 'Claim URL',
        value: winData.claimUrl,
        inline: false,
      });
    }
    if (winData.profileName) {
      fields.push({
        name: 'Profile',
        value: winData.profileName,
        inline: true,
      });
    }

    embed.fields = fields;
  }

  return {
    content: `**${notification.title}**`,
    embeds: [embed],
  };
}

/**
 * Formats an AppNotification as a generic JSON payload.
 */
function formatGenericPayload(notification: AppNotification): Record<string, unknown> {
  return {
    type: notification.type,
    title: notification.title,
    message: notification.message,
    priority: notification.priority,
    data: notification.data,
    timestamp: notification.timestamp ?? new Date().toISOString(),
  };
}

export class WebhookChannel implements NotificationChannel {
  readonly name = 'webhook';
  private readonly urls: string[];

  constructor(urls: string[]) {
    this.urls = urls.filter((u) => u.length > 0);
  }

  /**
   * Sends a notification to all configured webhook URLs.
   * Returns true if at least one webhook succeeded.
   */
  async send(notification: AppNotification): Promise<boolean> {
    if (this.urls.length === 0) {
      log.debug('No webhook URLs configured, skipping');
      return false;
    }

    const results = await Promise.allSettled(
      this.urls.map((url) => this.sendToUrl(url, notification)),
    );

    const successes = results.filter(
      (r) => r.status === 'fulfilled' && r.value === true,
    );

    if (successes.length === 0 && this.urls.length > 0) {
      log.error(
        { urlCount: this.urls.length, type: notification.type },
        'All webhook deliveries failed',
      );
      return false;
    }

    log.info(
      { successes: successes.length, total: this.urls.length, type: notification.type },
      'Webhook notifications sent',
    );
    return true;
  }

  /**
   * Sends a notification to a single webhook URL with retry logic.
   */
  private async sendToUrl(
    url: string,
    notification: AppNotification,
  ): Promise<boolean> {
    const format = detectFormat(url);
    let payload: unknown;

    switch (format) {
      case 'slack':
        payload = formatSlackPayload(notification);
        break;
      case 'discord':
        payload = formatDiscordPayload(notification);
        break;
      case 'generic':
        payload = formatGenericPayload(notification);
        break;
    }

    return retry(
      async () => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => 'unable to read body');
          throw new Error(
            `Webhook returned ${response.status}: ${body}`,
          );
        }

        log.debug({ url: url.slice(0, 50), format }, 'Webhook delivered');
        return true;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        onRetry: (error, attempt, delayMs) => {
          log.warn(
            { url: url.slice(0, 50), attempt, delayMs, error: error.message },
            'Retrying webhook delivery',
          );
        },
      },
    );
  }
}
