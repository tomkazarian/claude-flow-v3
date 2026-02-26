/**
 * Audit trail service.
 * Records significant platform actions for compliance and debugging.
 * Uses real database transactions for batch operations.
 */

import { getDb, getSqlite } from '../db/index.js';
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
   * Record multiple audit events atomically in a single transaction.
   * If any insert fails, the entire batch is rolled back. This ensures
   * audit trail consistency and improves performance for bulk operations
   * by avoiding per-row fsync overhead.
   */
  async recordBatch(entries: AuditEntry[]): Promise<void> {
    if (entries.length === 0) return;

    try {
      const db = getDb();
      const sqlite = getSqlite();
      const now = new Date().toISOString();

      const insertBatch = sqlite.transaction(() => {
        for (const entry of entries) {
          db.insert(auditLog)
            .values({
              id: generateId(),
              action: entry.action,
              entityType: entry.entityType,
              entityId: entry.entityId,
              details: entry.details ? JSON.stringify(entry.details) : '{}',
              createdAt: now,
            })
            .run();
        }
      });

      insertBatch();

      log.debug(
        { count: entries.length },
        'Audit batch recorded in transaction',
      );
    } catch (error) {
      // Audit failures should never crash the application
      log.error(
        { err: error, count: entries.length },
        'Failed to record audit batch, falling back to individual inserts',
      );
      // Fall back to individual inserts so partial data is still captured
      for (const entry of entries) {
        await this.record(entry);
      }
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
