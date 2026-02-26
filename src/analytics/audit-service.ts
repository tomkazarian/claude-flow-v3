/**
 * Audit trail service.
 * Records significant platform actions for compliance and debugging.
 */

import { getDb } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import { generateId } from '../shared/crypto.js';
import { getLogger } from '../shared/logger.js';

const log = getLogger('analytics', { service: 'audit' });

export type AuditAction =
  | 'entry.submitted'
  | 'entry.confirmed'
  | 'entry.failed'
  | 'entry.retried'
  | 'captcha.solved'
  | 'captcha.failed'
  | 'profile.created'
  | 'profile.updated'
  | 'profile.deleted'
  | 'contest.discovered'
  | 'contest.entered'
  | 'win.detected'
  | 'win.confirmed'
  | 'settings.updated'
  | 'export.generated'
  | 'discovery.run'
  | 'queue.paused'
  | 'queue.resumed';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
  profileId?: string;
}

export class AuditService {
  /**
   * Record an audit event.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      const db = getDb();
      db.insert(auditLog)
        .values({
          id: generateId(),
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          details: entry.details ? JSON.stringify(entry.details) : '{}',
          createdAt: new Date().toISOString(),
        })
        .run();

      log.debug(
        { action: entry.action, entityType: entry.entityType, entityId: entry.entityId },
        'Audit event recorded',
      );
    } catch (error) {
      // Audit failures should never crash the application
      log.error({ err: error, entry }, 'Failed to record audit event');
    }
  }

  /**
   * Record multiple audit events.
   */
  async recordBatch(entries: AuditEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.record(entry);
    }
  }
}

// Singleton instance
let auditServiceInstance: AuditService | null = null;

export function getAuditService(): AuditService {
  if (!auditServiceInstance) {
    auditServiceInstance = new AuditService();
  }
  return auditServiceInstance;
}
