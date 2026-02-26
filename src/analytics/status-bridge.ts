/**
 * Bridges the application eventBus to the StatusCollector for real-time monitoring.
 * Call initStatusBridge() once at startup after all subsystems are initialized.
 */

import { eventBus } from '../shared/events.js';
import { getStatusCollector } from './status-collector.js';
import { getLogger } from '../shared/logger.js';

const logger = getLogger('analytics', { service: 'status-bridge' });

export function initStatusBridge(): void {
  const collector = getStatusCollector();

  eventBus.on('entry:started', (data) => {
    collector.recordEvent({
      type: 'entry_started',
      message: `Entry started for contest ${data.contestId}`,
      data: data as unknown as Record<string, unknown>,
    });
  });

  eventBus.on('entry:confirmed', (data) => {
    collector.recordEvent({
      type: 'entry_completed',
      message: `Entry confirmed: ${data.entryId}`,
      data: data as unknown as Record<string, unknown>,
    });
  });

  eventBus.on('entry:failed', (data) => {
    collector.recordEvent({
      type: 'entry_failed',
      message: `Entry failed: ${data.error}`,
      data: data as unknown as Record<string, unknown>,
    });
  });

  eventBus.on('captcha:solved', (data) => {
    collector.recordEvent({
      type: 'captcha_solved',
      message: `CAPTCHA solved (${data.type})`,
      data: data as unknown as Record<string, unknown>,
    });
  });

  eventBus.on('captcha:failed', (data) => {
    collector.recordEvent({
      type: 'captcha_failed',
      message: `CAPTCHA failed: ${data.error}`,
      data: data as unknown as Record<string, unknown>,
    });
  });

  eventBus.on('win:detected', (data) => {
    collector.recordEvent({
      type: 'win_detected',
      message: `Win detected for entry ${data.entryId}!`,
      data: data as unknown as Record<string, unknown>,
    });
  });

  eventBus.on('discovery:completed', (data) => {
    collector.recordEvent({
      type: 'discovery_complete',
      message: `Discovery run completed for ${data.source}: ${data.contestsFound} contests found`,
      data: data as unknown as Record<string, unknown>,
    });
  });

  logger.info('Status bridge initialized - forwarding eventBus events to StatusCollector');
}
