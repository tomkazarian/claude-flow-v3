/**
 * Compliance module public API.
 *
 * Provides eligibility checking, age verification, geographic restriction
 * enforcement, entry limit tracking, terms parsing, and tax reporting.
 */

export {
  ComplianceEngine,
  type Contest,
  type Profile as ComplianceProfile,
  type ComplianceViolation,
  type ComplianceResult,
} from './rules-engine.js';

export { verifyAge } from './age-verifier.js';

export { checkGeoEligibility } from './geo-checker.js';

export { EntryLimiter } from './entry-limiter.js';

export {
  TermsParser,
  type ParsedTerms,
} from './terms-parser.js';

export {
  TaxTracker,
  type WinSummary,
  type TaxReport,
} from './tax-tracker.js';
