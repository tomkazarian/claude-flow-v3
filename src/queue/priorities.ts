/**
 * Priority calculation logic for contests.
 * Returns a score between 0-100 that determines processing order in the queue.
 *
 * Higher score = higher priority = processed sooner.
 */

import { getLogger } from '../shared/logger.js';

const log = getLogger('queue', { component: 'priorities' });

/** Minimal contest shape needed for priority scoring. */
export interface PrioritizableContest {
  id: string;
  prizeValue: number | null;
  endDate: string | Date | null;
  entryFrequency: string | null;
  difficultyScore: number | null;
  legitimacyScore: number | null;
  type: string;
}

/**
 * Calculates a priority score (0-100) for a contest based on multiple weighted factors.
 *
 * Factor breakdown:
 *  - Prize value:       up to +30 (logarithmic scale)
 *  - Time remaining:    up to +20 (urgency bonus for near-deadline)
 *  - Entry frequency:   up to +10 (daily contests get bonus for recurring value)
 *  - Difficulty:        up to +15 (lower difficulty = higher score)
 *  - Legitimacy:        up to +15 (higher legitimacy = higher score)
 *  - Type bonus:        +10 for instant_win
 */
export function calculatePriority(contest: PrioritizableContest): number {
  let score = 0;

  // ---------- Prize value (max +30, log scale) ----------
  const prizeValue = contest.prizeValue ?? 0;
  if (prizeValue > 0) {
    // log10 scale: $10 -> ~10, $100 -> ~20, $1000 -> ~30
    const logScore = Math.log10(Math.max(1, prizeValue)) * 10;
    score += Math.min(30, logScore);
  }

  // ---------- Time remaining (max +20) ----------
  if (contest.endDate) {
    const endMs =
      contest.endDate instanceof Date
        ? contest.endDate.getTime()
        : new Date(contest.endDate).getTime();

    if (!isNaN(endMs)) {
      const hoursRemaining = (endMs - Date.now()) / (1000 * 60 * 60);

      if (hoursRemaining > 0) {
        if (hoursRemaining < 24) {
          // Less than 24 hours: maximum urgency
          score += 20;
        } else if (hoursRemaining < 72) {
          // 1-3 days: high urgency
          score += 15;
        } else if (hoursRemaining < 168) {
          // 3-7 days: moderate urgency
          score += 10;
        } else if (hoursRemaining < 720) {
          // 7-30 days: low urgency
          score += 5;
        }
        // > 30 days: no urgency bonus
      }
    }
  }

  // ---------- Entry frequency (max +10) ----------
  const frequency = contest.entryFrequency ?? 'once';
  if (frequency === 'daily') {
    score += 10;
  } else if (frequency === 'weekly') {
    score += 5;
  }
  // 'once' and 'unlimited' get no bonus

  // ---------- Difficulty (max +15, lower difficulty = higher score) ----------
  const difficulty = contest.difficultyScore ?? 0.5;
  // Invert: difficulty 0 -> +15, difficulty 1 -> 0
  score += Math.max(0, (1 - difficulty) * 15);

  // ---------- Legitimacy (max +15) ----------
  const legitimacy = contest.legitimacyScore ?? 0.5;
  score += Math.max(0, legitimacy * 15);

  // ---------- Type bonus ----------
  if (contest.type === 'instant_win') {
    score += 10;
  }

  // Clamp to 0-100
  const finalScore = Math.max(0, Math.min(100, Math.round(score)));

  log.debug(
    {
      contestId: contest.id,
      score: finalScore,
      prizeValue,
      type: contest.type,
      entryFrequency: frequency,
    },
    'Calculated contest priority',
  );

  return finalScore;
}
