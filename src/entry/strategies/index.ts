/**
 * Strategy registry - maps entry methods to strategy classes.
 *
 * The orchestrator uses this registry to select the appropriate
 * strategy for each contest based on its entry method and type.
 */

import { getLogger } from '../../shared/logger.js';
import { ENTRY_METHODS, CONTEST_TYPES } from '../../shared/constants.js';
import { SimpleFormStrategy } from './simple-form.strategy.js';
import { MultiStepStrategy } from './multi-step.strategy.js';
import { InstantWinStrategy } from './instant-win.strategy.js';
import type { EntryStrategy } from '../types.js';

const log = getLogger('entry', { component: 'strategy-registry' });

/**
 * Map of entry method identifiers to their strategy implementations.
 */
const STRATEGY_MAP: Record<string, () => EntryStrategy> = {
  // Form-based entries
  [ENTRY_METHODS.FORM]: () => new SimpleFormStrategy(),
  [ENTRY_METHODS.EMAIL]: () => new SimpleFormStrategy(),
  [ENTRY_METHODS.NEWSLETTER]: () => new SimpleFormStrategy(),
  [ENTRY_METHODS.SURVEY]: () => new SimpleFormStrategy(),

  // Social entries (still use form strategy for the entry page)
  [ENTRY_METHODS.SOCIAL_FOLLOW]: () => new SimpleFormStrategy(),
  [ENTRY_METHODS.SOCIAL_SHARE]: () => new SimpleFormStrategy(),
  [ENTRY_METHODS.SOCIAL_LIKE]: () => new SimpleFormStrategy(),
  [ENTRY_METHODS.SOCIAL_COMMENT]: () => new SimpleFormStrategy(),
  [ENTRY_METHODS.SOCIAL_RETWEET]: () => new SimpleFormStrategy(),
  [ENTRY_METHODS.REFERRAL_LINK]: () => new SimpleFormStrategy(),
  [ENTRY_METHODS.VIDEO_WATCH]: () => new SimpleFormStrategy(),
  [ENTRY_METHODS.APP_DOWNLOAD]: () => new SimpleFormStrategy(),
};

/**
 * Map of contest type identifiers to their strategy implementations.
 * Used as a fallback when the entry method does not have a specific mapping.
 */
const TYPE_STRATEGY_MAP: Record<string, () => EntryStrategy> = {
  [CONTEST_TYPES.INSTANT_WIN]: () => new InstantWinStrategy(),
  [CONTEST_TYPES.SWEEPSTAKES]: () => new SimpleFormStrategy(),
  [CONTEST_TYPES.GIVEAWAY]: () => new SimpleFormStrategy(),
  [CONTEST_TYPES.DAILY_ENTRY]: () => new SimpleFormStrategy(),
  [CONTEST_TYPES.SOCIAL_MEDIA]: () => new SimpleFormStrategy(),
};

/**
 * Select the appropriate entry strategy for a contest.
 *
 * Strategy selection priority:
 * 1. Contest type "instant_win" always gets InstantWinStrategy
 * 2. Entry method mapping
 * 3. Contest type fallback
 * 4. Default: SimpleFormStrategy
 */
export function selectStrategy(
  entryMethod: string,
  contestType: string,
  isMultiStep: boolean = false,
): EntryStrategy {
  // Priority 1: Instant win contests always use instant win strategy
  if (contestType === CONTEST_TYPES.INSTANT_WIN || contestType === 'instant_win') {
    log.debug({ contestType }, 'Selected InstantWinStrategy based on contest type');
    return new InstantWinStrategy();
  }

  // Priority 2: Multi-step forms use multi-step strategy
  if (isMultiStep) {
    log.debug({ entryMethod, contestType }, 'Selected MultiStepStrategy based on multi-step detection');
    return new MultiStepStrategy();
  }

  // Priority 3: Entry method mapping
  const methodFactory = STRATEGY_MAP[entryMethod];
  if (methodFactory) {
    const strategy = methodFactory();
    log.debug({ entryMethod, strategy: strategy.name }, 'Selected strategy based on entry method');
    return strategy;
  }

  // Priority 4: Contest type fallback
  const typeFactory = TYPE_STRATEGY_MAP[contestType];
  if (typeFactory) {
    const strategy = typeFactory();
    log.debug({ contestType, strategy: strategy.name }, 'Selected strategy based on contest type');
    return strategy;
  }

  // Default: SimpleFormStrategy
  log.debug(
    { entryMethod, contestType },
    'No specific strategy found, using SimpleFormStrategy as default',
  );
  return new SimpleFormStrategy();
}

/**
 * Get all available strategy names.
 */
export function getAvailableStrategies(): string[] {
  return ['simple-form', 'multi-step', 'instant-win'];
}

// Re-exports
export { SimpleFormStrategy } from './simple-form.strategy.js';
export { MultiStepStrategy } from './multi-step.strategy.js';
export { InstantWinStrategy } from './instant-win.strategy.js';
