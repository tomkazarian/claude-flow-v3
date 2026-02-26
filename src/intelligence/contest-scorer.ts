/**
 * Contest scoring engine.
 *
 * Evaluates contests by difficulty (how hard to enter) and ROI
 * (expected value vs time/cost), then produces a recommendation.
 */

import { getLogger } from '../shared/logger.js';

const log = getLogger('queue', { component: 'contest-scorer' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal contest shape required for scoring. */
export interface ScorableContest {
  id: string;
  url: string;
  title: string;
  type: string;
  prizeValue: number | null;
  prizeDescription?: string;
  requiresCaptcha?: boolean | number;
  requiresEmailConfirm?: boolean | number;
  requiresSmsVerify?: boolean | number;
  requiresSocialAction?: boolean | number;
  entryMethod: string;
  legitimacyScore: number | null;
  difficultyScore?: number | null;
}

export interface ContestScore {
  /** Normalized difficulty from 0 (trivial) to 1 (extremely hard). */
  difficulty: number;
  /** Return on investment: prize_value / estimated_time_cost. */
  roi: number;
  /** Priority score 0-100 for queue ordering. */
  priority: number;
  /** Actionable recommendation. */
  recommendation: 'enter' | 'skip' | 'monitor';
  /** Human-readable explanation for the recommendation. */
  reason: string;
  /** Individual factor breakdowns. */
  factors: DifficultyFactor[];
}

interface DifficultyFactor {
  name: string;
  weight: number;
  present: boolean;
}

// ---------------------------------------------------------------------------
// Difficulty weights
// ---------------------------------------------------------------------------

const DIFFICULTY_WEIGHTS: Record<string, number> = {
  captcha: 0.2,
  multiStep: 0.15,
  socialAction: 0.15,
  emailConfirm: 0.1,
  smsVerify: 0.2,
  purchaseRequired: 0.5,
};

/** Estimated time cost per entry in minutes, used for ROI calculation. */
const ESTIMATED_TIME_COSTS: Record<string, number> = {
  form: 2,
  social: 3,
  email: 1.5,
  purchase: 10,
  multi: 5,
};

// ---------------------------------------------------------------------------
// ContestScorer
// ---------------------------------------------------------------------------

export class ContestScorer {
  /**
   * Scores a contest on difficulty, ROI, and provides a recommendation.
   */
  score(contest: ScorableContest): ContestScore {
    const factors = this.assessDifficultyFactors(contest);
    const difficulty = this.calculateDifficulty(factors);
    const roi = this.calculateRoi(contest, difficulty);
    const priority = this.calculatePriority(contest, difficulty, roi);
    const { recommendation, reason } = this.determineRecommendation(
      difficulty,
      contest.legitimacyScore ?? 0.5,
      roi,
    );

    const result: ContestScore = {
      difficulty,
      roi,
      priority,
      recommendation,
      reason,
      factors,
    };

    log.debug(
      {
        contestId: contest.id,
        difficulty: Math.round(difficulty * 100) / 100,
        roi: Math.round(roi * 100) / 100,
        priority,
        recommendation,
      },
      'Contest scored',
    );

    return result;
  }

  // -------------------------------------------------------------------------
  // Private methods
  // -------------------------------------------------------------------------

  /**
   * Assesses which difficulty factors are present for a contest.
   */
  private assessDifficultyFactors(
    contest: ScorableContest,
  ): DifficultyFactor[] {
    return [
      {
        name: 'captcha',
        weight: DIFFICULTY_WEIGHTS['captcha'] ?? 0,
        present: toBool(contest.requiresCaptcha),
      },
      {
        name: 'multiStep',
        weight: DIFFICULTY_WEIGHTS['multiStep'] ?? 0,
        present: contest.entryMethod === 'multi',
      },
      {
        name: 'socialAction',
        weight: DIFFICULTY_WEIGHTS['socialAction'] ?? 0,
        present: toBool(contest.requiresSocialAction) || contest.entryMethod === 'social',
      },
      {
        name: 'emailConfirm',
        weight: DIFFICULTY_WEIGHTS['emailConfirm'] ?? 0,
        present: toBool(contest.requiresEmailConfirm),
      },
      {
        name: 'smsVerify',
        weight: DIFFICULTY_WEIGHTS['smsVerify'] ?? 0,
        present: toBool(contest.requiresSmsVerify),
      },
      {
        name: 'purchaseRequired',
        weight: DIFFICULTY_WEIGHTS['purchaseRequired'] ?? 0,
        present: contest.entryMethod === 'purchase',
      },
    ];
  }

  /**
   * Calculates a normalized difficulty score (0-1) from individual factors.
   */
  private calculateDifficulty(factors: DifficultyFactor[]): number {
    let total = 0;
    for (const factor of factors) {
      if (factor.present) {
        total += factor.weight;
      }
    }
    // Clamp to [0, 1]
    return Math.min(1, Math.max(0, total));
  }

  /**
   * Calculates return on investment as prize_value / estimated_time_cost.
   * Higher ROI = more valuable to enter.
   */
  private calculateRoi(
    contest: ScorableContest,
    difficulty: number,
  ): number {
    const prizeValue = contest.prizeValue ?? 0;
    if (prizeValue <= 0) {
      return 0;
    }

    const baseTimeCost =
      ESTIMATED_TIME_COSTS[contest.entryMethod] ??
      ESTIMATED_TIME_COSTS['form'] ??
      2;

    // Scale time cost by difficulty (harder entries take longer)
    const adjustedTimeCost = baseTimeCost * (1 + difficulty);

    if (adjustedTimeCost <= 0) {
      return 0;
    }

    return prizeValue / adjustedTimeCost;
  }

  /**
   * Calculates a priority score (0-100) combining difficulty and ROI.
   */
  private calculatePriority(
    contest: ScorableContest,
    difficulty: number,
    roi: number,
  ): number {
    // Base priority from ROI (log-scale, max 50 points)
    const roiScore = roi > 0 ? Math.min(50, Math.log10(Math.max(1, roi)) * 20) : 0;

    // Ease bonus: easier contests get more points (max 25)
    const easeScore = (1 - difficulty) * 25;

    // Legitimacy bonus (max 15)
    const legitimacy = contest.legitimacyScore ?? 0.5;
    const legitimacyScore = legitimacy * 15;

    // Type bonus (max 10)
    const typeBonus = contest.type === 'instant_win' ? 10 : 0;

    const total = roiScore + easeScore + legitimacyScore + typeBonus;
    return Math.max(0, Math.min(100, Math.round(total)));
  }

  /**
   * Determines whether to enter, skip, or monitor a contest.
   */
  private determineRecommendation(
    difficulty: number,
    legitimacy: number,
    roi: number,
  ): { recommendation: 'enter' | 'skip' | 'monitor'; reason: string } {
    // Hard skip conditions
    if (difficulty > 0.9) {
      return {
        recommendation: 'skip',
        reason: 'Difficulty too high (>0.9) -- likely requires purchase or excessive steps',
      };
    }

    if (legitimacy < 0.3) {
      return {
        recommendation: 'skip',
        reason: 'Legitimacy too low (<0.3) -- contest may be fraudulent or expired',
      };
    }

    // Clear enter conditions
    if (difficulty < 0.7 && legitimacy > 0.5) {
      if (roi > 10) {
        return {
          recommendation: 'enter',
          reason: 'Good ROI with manageable difficulty and acceptable legitimacy',
        };
      }
      return {
        recommendation: 'enter',
        reason: 'Low difficulty and good legitimacy -- worth entering',
      };
    }

    // Monitor conditions (borderline cases)
    if (difficulty >= 0.7 && difficulty <= 0.9) {
      return {
        recommendation: 'monitor',
        reason: 'Moderate-to-high difficulty -- monitor for form changes or simplification',
      };
    }

    if (legitimacy >= 0.3 && legitimacy <= 0.5) {
      return {
        recommendation: 'monitor',
        reason: 'Borderline legitimacy -- needs manual verification before entering',
      };
    }

    return {
      recommendation: 'monitor',
      reason: 'Does not meet clear enter or skip criteria -- requires further analysis',
    };
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Converts a boolean or integer (from SQLite) to a boolean.
 */
function toBool(value: boolean | number | undefined | null): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}
