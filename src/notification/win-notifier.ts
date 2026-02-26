/**
 * Win-specific notification logic.
 * Formats rich win notifications, updates claim status, and logs to audit_log.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { wins, contests, profiles, auditLog } from '../db/schema.js';
import { getLogger } from '../shared/logger.js';
import { generateId } from '../shared/crypto.js';
import { AppError } from '../shared/errors.js';
import type { WinData } from './types.js';
import { NotificationManager } from './notification-manager.js';

const log = getLogger('notification', { service: 'win-notifier' });

/**
 * Type for the win row returned from the database query.
 */
interface WinRow {
  id: string;
  entryId: string;
  contestId: string;
  profileId: string;
  prizeDescription: string | null;
  prizeValue: number | null;
  claimDeadline: string | null;
  claimUrl: string | null;
  claimStatus: string;
}

interface ContestRow {
  id: string;
  title: string;
}

interface ProfileRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export class WinNotifier {
  private readonly notificationManager: NotificationManager;

  constructor(notificationManager: NotificationManager) {
    this.notificationManager = notificationManager;
  }

  /**
   * Sends a rich notification for a detected win.
   * Also updates the win's claim_status to 'notified' and logs to audit_log.
   *
   * @param winId - ID of the win record in the database
   * @param contestId - ID of the contest
   * @param profileId - ID of the profile that won
   */
  async notifyWin(winId: string, contestId: string, profileId: string): Promise<void> {
    const db = getDb();

    // Fetch win details
    const win = db
      .select()
      .from(wins)
      .where(eq(wins.id, winId))
      .get() as WinRow | undefined;

    if (!win) {
      throw new AppError(
        `Win record not found: ${winId}`,
        'WIN_NOT_FOUND',
        404,
      );
    }

    // Fetch contest details
    const contest = db
      .select({
        id: contests.id,
        title: contests.title,
      })
      .from(contests)
      .where(eq(contests.id, contestId))
      .get() as ContestRow | undefined;

    if (!contest) {
      throw new AppError(
        `Contest not found: ${contestId}`,
        'CONTEST_NOT_FOUND',
        404,
      );
    }

    // Fetch profile details
    const profile = db
      .select({
        id: profiles.id,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
      })
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .get() as ProfileRow | undefined;

    if (!profile) {
      throw new AppError(
        `Profile not found: ${profileId}`,
        'PROFILE_NOT_FOUND',
        404,
      );
    }

    // Build win notification data
    const winData: WinData = {
      winId: win.id,
      entryId: win.entryId,
      contestId: win.contestId,
      profileId: win.profileId,
      prizeDescription: win.prizeDescription ?? 'Unknown prize',
      prizeValue: win.prizeValue,
      claimDeadline: win.claimDeadline,
      claimUrl: win.claimUrl,
      contestTitle: contest.title,
      profileName: `${profile.firstName} ${profile.lastName}`,
    };

    // Send notification to all channels
    try {
      await this.notificationManager.notifyWin(winData);
      log.info(
        { winId, contestId, profileId },
        'Win notification sent successfully',
      );
    } catch (error) {
      log.error(
        { err: error, winId, contestId },
        'Failed to send win notification',
      );
      // Continue to update status even if notification fails
    }

    // Update win claim_status to 'notified'
    try {
      db.update(wins)
        .set({
          claimStatus: 'notified',
          updatedAt: new Date().toISOString(),
        })
        .where(eq(wins.id, winId))
        .run();

      log.info({ winId }, 'Win claim status updated to notified');
    } catch (error) {
      log.error(
        { err: error, winId },
        'Failed to update win claim status',
      );
    }

    // Log win notification to audit_log
    try {
      db.insert(auditLog)
        .values({
          id: generateId(),
          action: 'win_notified',
          entityType: 'win',
          entityId: winId,
          details: JSON.stringify({
            contestId,
            profileId,
            prizeDescription: win.prizeDescription,
            prizeValue: win.prizeValue,
            claimDeadline: win.claimDeadline,
            notifiedAt: new Date().toISOString(),
          }),
        })
        .run();
    } catch (error) {
      log.error(
        { err: error, winId },
        'Failed to log win notification to audit log',
      );
    }
  }
}
