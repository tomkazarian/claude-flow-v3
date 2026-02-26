/**
 * Intelligence module public API.
 *
 * Re-exports the contest scorer, priority engine, pattern learner,
 * and change detector for use by the rest of the application.
 */

export { ContestScorer } from './contest-scorer.js';
export type { ScorableContest, ContestScore, HistoricalData } from './contest-scorer.js';

export { PriorityEngine } from './priority-engine.js';
export type { RankedContest } from './priority-engine.js';

export { PatternLearner } from './pattern-learner.js';

export { ChangeDetector } from './change-detector.js';
export type { ChangeResult } from './change-detector.js';
