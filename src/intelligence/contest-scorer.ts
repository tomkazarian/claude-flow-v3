/**
 * Contest scoring engine.
 *
 * Evaluates contests by difficulty (how hard to enter) and ROI
 * (expected value vs time/cost), then produces a recommendation.
 *
 * When historical data is available (via scoreWithHistory), the engine
 * queries the database for domain-level and type-level success rates
 * to refine its scoring. Without historical data, it falls back to
 * static heuristic weights.
 */

import { eq, sql, count } from 'drizzle-orm';
import { getLogger } from '../shared/logger.js';
import { extractDomain } from '../shared/utils.js';

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

/** Historical performance data used to refine scoring. */
export interface HistoricalData {
  /** Success rate for this domain (0-1), null if no data. */
  domainSuccessRate: number | null;
  /** Total entries attempted on this domain. */
  domainEntryCount: number;
  /** Success rate for this contest type (0-1), null if no data. */
  typeSuccessRate: number | null;
  /** Total entries attempted for this contest type. */
  typeEntryCount: number;
  /** Average win value for this domain, null if no wins. */
  domainAvgWinValue: number | null;
}

export class ContestScorer {
  /**
   * Scores a contest on difficulty, ROI, and provides a recommendation.
   * Uses static heuristic weights only (no database queries).
   */
  score(contest: ScorableContest): ContestScore {
    return this.scoreInternal(contest, null);
  }

  /**
   * Scores a contest with historical performance data from the database.
   * Queries domain-level and type-level success rates to refine the
   * static heuristic score. Falls back to heuristics when insufficient
   * historical data exists.
   */
  async scoreWithHistory(contest: ScorableContest): Promise<ContestScore> {
    let history: HistoricalData | null = null;
    try {
      history = await this.fetchHistoricalData(contest);
    } catch (err) {
      log.warn(
        { err, contestId: contest.id },
        'Failed to fetch historical data, falling back to heuristics',
      );
    }
    return this.scoreInternal(contest, history);
  }

  /**
   * Fetches historical performance data for a contest from the database.
   * Returns domain-level success rates, type-level success rates, and
   * average win values.
   */
  async fetchHistoricalData(
    contest: ScorableContest,
  ): Promise<HistoricalData> {
    const { getDb } = await import('../db/index.js');
    const { entries, contests, wins } = await import('../db/schema.js');
    const db = getDb();

    const domain = extractDomain(contest.url);

    // Domain-level success rate: join entries with contests, extract domain,
    // compute success rate for entries on matching domains.
    const domainResult = db
      .select({
        total: count(),
        successful: sql<number>`sum(case when ${entries.status} in ('submitted','confirmed','won') then 1 else 0 end)`,
      })
      .from(entries)
      .innerJoin(contests, eq(entries.contestId, contests.id))
      .where(
        sql`replace(replace(substr(${contests.url}, instr(${contests.url}, '://') + 3), 'www.', ''), substr(substr(${contests.url}, instr(${contests.url}, '://') + 3), instr(substr(${contests.url}, instr(${contests.url}, '://') + 3), '/')), '') = ${domain}`,
      )
      .get();

    const domainEntryCount = domainResult?.total ?? 0;
    const domainSuccessful = domainResult?.successful ?? 0;
    const domainSuccessRate =
      domainEntryCount > 0 ? domainSuccessful / domainEntryCount : null;

    // Type-level success rate
    const typeResult = db
      .select({
        total: count(),
        successful: sql<number>`sum(case when ${entries.status} in ('submitted','confirmed','won') then 1 else 0 end)`,
      })
      .from(entries)
      .innerJoin(contests, eq(entries.contestId, contests.id))
      .where(eq(contests.type, contest.type as typeof contests.type._.data))
      .get();

    const typeEntryCount = typeResult?.total ?? 0;
    const typeSuccessful = typeResult?.successful ?? 0;
    const typeSuccessRate =
      typeEntryCount > 0 ? typeSuccessful / typeEntryCount : null;

    // Average win value for this domain
    const winResult = db
      .select({
        avgValue: sql<number>`coalesce(avg(${wins.prizeValue}), 0)`,
        cnt: count(),
      })
      .from(wins)
      .innerJoin(contests, eq(wins.contestId, contests.id))
      .where(
        sql`replace(replace(substr(${contests.url}, instr(${contests.url}, '://') + 3), 'www.', ''), substr(substr(${contests.url}, instr(${contests.url}, '://') + 3), instr(substr(${contests.url}, instr(${contests.url}, '://') + 3), '/')), '') = ${domain}`,
      )
      .get();

    const domainAvgWinValue =
      (winResult?.cnt ?? 0) > 0 ? (winResult?.avgValue ?? null) : null;

    return {
      domainSuccessRate,
      domainEntryCount,
      typeSuccessRate,
      typeEntryCount,
      domainAvgWinValue,
    };
  }

  // -------------------------------------------------------------------------
  // Internal scoring
  // -------------------------------------------------------------------------

  private scoreInternal(
    contest: ScorableContest,
    history: HistoricalData | null,
  ): ContestScore {
    const factors = this.assessDifficultyFactors(contest);
    const difficulty = this.calculateDifficulty(factors);
    const roi = this.calculateRoi(contest, difficulty, history);
    const priority = this.calculatePriority(contest, difficulty, roi, history);
    const { recommendation, reason } = this.determineRecommendation(
      difficulty,
      contest.legitimacyScore ?? 0.5,
      roi,
      history,
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
        hasHistory: history !== null,
        domainSuccessRate: history?.domainSuccessRate,
        typeSuccessRate: history?.typeSuccessRate,
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
   * Calculates return on investment as prize_value / estimated_time_cost,
   * weighted by historical success rate when available.
   *
   * When historical data is present:
   * - Uses actual domain win values if known
   * - Applies domain success rate as a probability multiplier (expected value)
   * - Falls back to type success rate if domain data is insufficient
   */
  private calculateRoi(
    contest: ScorableContest,
    difficulty: number,
    history?: HistoricalData | null,
  ): number {
    // Use actual average win value from domain if we have sufficient data
    let prizeValue = contest.prizeValue ?? 0;
    if (
      history?.domainAvgWinValue != null &&
      history.domainAvgWinValue > 0 &&
      prizeValue <= 0
    ) {
      prizeValue = history.domainAvgWinValue;
    }

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

    let rawRoi = prizeValue / adjustedTimeCost;

    // Apply historical success rate as a probability multiplier (expected value).
    // Only apply if we have meaningful sample size (10+ entries).
    if (history) {
      if (
        history.domainSuccessRate != null &&
        history.domainEntryCount >= 10
      ) {
        // Weight by actual domain success rate
        rawRoi *= history.domainSuccessRate;
      } else if (
        history.typeSuccessRate != null &&
        history.typeEntryCount >= 10
      ) {
        // Fall back to type-level success rate
        rawRoi *= history.typeSuccessRate;
      }
    }

    return rawRoi;
  }

  /**
   * Calculates a priority score (0-100) combining difficulty, ROI,
   * and historical performance data when available.
   */
  private calculatePriority(
    contest: ScorableContest,
    difficulty: number,
    roi: number,
    history?: HistoricalData | null,
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

    let total = roiScore + easeScore + legitimacyScore + typeBonus;

    // Historical performance adjustment (up to +/- 15 points).
    // Boost contests on domains with proven success; penalize domains
    // that historically fail. Requires 10+ entries minimum.
    if (history) {
      if (
        history.domainSuccessRate != null &&
        history.domainEntryCount >= 10
      ) {
        // Scale: 0% success -> -10, 50% -> 0, 100% -> +15
        const historyBonus = (history.domainSuccessRate - 0.4) * 25;
        total += Math.max(-10, Math.min(15, historyBonus));
      } else if (
        history.typeSuccessRate != null &&
        history.typeEntryCount >= 10
      ) {
        // Smaller adjustment for type-level data (less specific)
        const typeBonus2 = (history.typeSuccessRate - 0.4) * 15;
        total += Math.max(-5, Math.min(10, typeBonus2));
      }
    }

    return Math.max(0, Math.min(100, Math.round(total)));
  }

  /**
   * Determines whether to enter, skip, or monitor a contest.
   * When historical data is available, uses actual success rates to
   * override or refine the heuristic recommendation.
   */
  private determineRecommendation(
    difficulty: number,
    legitimacy: number,
    roi: number,
    history?: HistoricalData | null,
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

    // Historical data override: if we have strong evidence from past entries
    // on the same domain, use that to make a more informed decision.
    if (
      history?.domainSuccessRate != null &&
      history.domainEntryCount >= 20
    ) {
      if (history.domainSuccessRate < 0.05) {
        return {
          recommendation: 'skip',
          reason: `Domain success rate extremely low (${(history.domainSuccessRate * 100).toFixed(1)}% over ${history.domainEntryCount} entries) -- historically unproductive`,
        };
      }

      if (history.domainSuccessRate > 0.6 && legitimacy >= 0.4) {
        return {
          recommendation: 'enter',
          reason: `Domain has strong historical success rate (${(history.domainSuccessRate * 100).toFixed(1)}% over ${history.domainEntryCount} entries)`,
        };
      }
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
