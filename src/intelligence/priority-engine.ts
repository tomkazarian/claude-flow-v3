/**
 * Priority engine for determining contest entry ordering.
 *
 * Ranks all eligible contests by a composite priority score and
 * provides batched retrieval for the queue scheduler.
 */

import { desc, and, sql, inArray } from 'drizzle-orm';
import { getLogger } from '../shared/logger.js';
import { getDb, schema } from '../db/index.js';
import { calculatePriority } from '../queue/priorities.js';
import { ContestScorer } from './contest-scorer.js';

const log = getLogger('queue', { component: 'priority-engine' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankedContest {
  id: string;
  url: string;
  title: string;
  type: string;
  prizeValue: number | null;
  entryMethod: string;
  endDate: string | null;
  entryFrequency: string | null;
  difficultyScore: number | null;
  legitimacyScore: number | null;
  status: string;
  /** 1-based rank in the ordered list. */
  rank: number;
  /** Composite priority score (0-100). */
  score: number;
  /** Human-readable reason for this ranking. */
  reason: string;
}

// ---------------------------------------------------------------------------
// PriorityEngine
// ---------------------------------------------------------------------------

export class PriorityEngine {
  private readonly scorer: ContestScorer;

  constructor() {
    this.scorer = new ContestScorer();
  }

  /**
   * Ranks all eligible contests by priority score (descending).
   *
   * Eligible contests are those with status 'discovered' or 'active'
   * and end_date in the future (or null).
   */
  rankContests(
    contests: Array<{
      id: string;
      url: string;
      title: string;
      type: string;
      prizeValue: number | null;
      prizeDescription?: string | null;
      entryMethod: string;
      endDate: string | null;
      entryFrequency: string | null;
      difficultyScore: number | null;
      legitimacyScore: number | null;
      status: string;
      requiresCaptcha?: number | null;
      requiresEmailConfirm?: number | null;
      requiresSmsVerify?: number | null;
      requiresSocialAction?: number | null;
    }>,
  ): RankedContest[] {
    const scored = contests.map((contest) => {
      // Calculate queue priority
      const queuePriority = calculatePriority({
        id: contest.id,
        prizeValue: contest.prizeValue,
        endDate: contest.endDate,
        entryFrequency: contest.entryFrequency,
        difficultyScore: contest.difficultyScore,
        legitimacyScore: contest.legitimacyScore,
        type: contest.type,
      });

      // Calculate contest score for recommendation
      const contestScore = this.scorer.score({
        id: contest.id,
        url: contest.url,
        title: contest.title,
        type: contest.type,
        prizeValue: contest.prizeValue,
        entryMethod: contest.entryMethod,
        legitimacyScore: contest.legitimacyScore,
        requiresCaptcha: contest.requiresCaptcha ?? 0,
        requiresEmailConfirm: contest.requiresEmailConfirm ?? 0,
        requiresSmsVerify: contest.requiresSmsVerify ?? 0,
        requiresSocialAction: contest.requiresSocialAction ?? 0,
      });

      // Combine queue priority and contest score
      const compositeScore = Math.round(
        queuePriority * 0.6 + contestScore.priority * 0.4,
      );

      return {
        id: contest.id,
        url: contest.url,
        title: contest.title,
        type: contest.type,
        prizeValue: contest.prizeValue,
        entryMethod: contest.entryMethod,
        endDate: contest.endDate,
        entryFrequency: contest.entryFrequency,
        difficultyScore: contest.difficultyScore,
        legitimacyScore: contest.legitimacyScore,
        status: contest.status,
        score: compositeScore,
        reason: contestScore.reason,
        recommendation: contestScore.recommendation,
      };
    });

    // Sort by score descending, then by end date ascending (urgency tiebreaker)
    scored.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      // Tiebreaker: sooner end date first
      if (a.endDate && b.endDate) {
        return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
      }
      if (a.endDate && !b.endDate) return -1;
      if (!a.endDate && b.endDate) return 1;
      return 0;
    });

    // Assign ranks and filter to only 'enter' recommendations
    return scored
      .filter((c) => c.recommendation !== 'skip')
      .map((contest, index) => ({
        id: contest.id,
        url: contest.url,
        title: contest.title,
        type: contest.type,
        prizeValue: contest.prizeValue,
        entryMethod: contest.entryMethod,
        endDate: contest.endDate,
        entryFrequency: contest.entryFrequency,
        difficultyScore: contest.difficultyScore,
        legitimacyScore: contest.legitimacyScore,
        status: contest.status,
        rank: index + 1,
        score: contest.score,
        reason: contest.reason,
      }));
  }

  /**
   * Retrieves and ranks the top N contests from the database.
   * Uses historical performance data to refine scoring when fetching
   * from the database (unlike rankContests which uses static weights).
   * Only includes contests that are eligible for entry.
   */
  async getNextBatch(count: number): Promise<RankedContest[]> {
    const db = getDb();
    const now = new Date().toISOString();

    // Fetch eligible contests
    const contests = db
      .select()
      .from(schema.contests)
      .where(
        and(
          inArray(schema.contests.status, ['discovered', 'active']),
          sql`(${schema.contests.endDate} IS NULL OR ${schema.contests.endDate} > ${now})`,
        ),
      )
      .orderBy(desc(schema.contests.priorityScore))
      .limit(count * 3) // Fetch extra for filtering
      .all();

    if (contests.length === 0) {
      log.info('No eligible contests found for ranking');
      return [];
    }

    // Score each contest with historical data for more accurate ranking.
    // We use scoreWithHistory which queries the DB for domain/type success
    // rates, then combine with queue priority.
    const scored = await Promise.all(
      contests.map(async (contest) => {
        const queuePriority = calculatePriority({
          id: contest.id,
          prizeValue: contest.prizeValue,
          endDate: contest.endDate,
          entryFrequency: contest.entryFrequency,
          difficultyScore: contest.difficultyScore,
          legitimacyScore: contest.legitimacyScore,
          type: contest.type,
        });

        const contestScore = await this.scorer.scoreWithHistory({
          id: contest.id,
          url: contest.url,
          title: contest.title,
          type: contest.type,
          prizeValue: contest.prizeValue,
          entryMethod: contest.entryMethod,
          legitimacyScore: contest.legitimacyScore,
          requiresCaptcha: contest.requiresCaptcha ?? 0,
          requiresEmailConfirm: contest.requiresEmailConfirm ?? 0,
          requiresSmsVerify: contest.requiresSmsVerify ?? 0,
          requiresSocialAction: contest.requiresSocialAction ?? 0,
        });

        const compositeScore = Math.round(
          queuePriority * 0.6 + contestScore.priority * 0.4,
        );

        return {
          id: contest.id,
          url: contest.url,
          title: contest.title,
          type: contest.type,
          prizeValue: contest.prizeValue,
          entryMethod: contest.entryMethod,
          endDate: contest.endDate,
          entryFrequency: contest.entryFrequency,
          difficultyScore: contest.difficultyScore,
          legitimacyScore: contest.legitimacyScore,
          status: contest.status,
          score: compositeScore,
          reason: contestScore.reason,
          recommendation: contestScore.recommendation,
        };
      }),
    );

    // Sort by score descending, then by end date ascending (urgency tiebreaker)
    scored.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      if (a.endDate && b.endDate) {
        return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
      }
      if (a.endDate && !b.endDate) return -1;
      if (!a.endDate && b.endDate) return 1;
      return 0;
    });

    // Assign ranks, filter out 'skip' recommendations
    const ranked = scored
      .filter((c) => c.recommendation !== 'skip')
      .map((contest, index) => ({
        id: contest.id,
        url: contest.url,
        title: contest.title,
        type: contest.type,
        prizeValue: contest.prizeValue,
        entryMethod: contest.entryMethod,
        endDate: contest.endDate,
        entryFrequency: contest.entryFrequency,
        difficultyScore: contest.difficultyScore,
        legitimacyScore: contest.legitimacyScore,
        status: contest.status,
        rank: index + 1,
        score: contest.score,
        reason: contest.reason,
      }));

    // Return the top N
    const batch = ranked.slice(0, count);

    log.info(
      {
        eligible: contests.length,
        ranked: ranked.length,
        returned: batch.length,
        topScore: batch[0]?.score,
        bottomScore: batch[batch.length - 1]?.score,
      },
      'Next batch of ranked contests retrieved (with historical data)',
    );

    return batch;
  }
}
