/**
 * Entry module public API.
 *
 * Re-exports all types and classes needed by consumers of the
 * sweepstakes entry automation pipeline: orchestration, form
 * analysis, filling, strategies, and result handling.
 */

// Types
export type {
  Profile,
  Contest,
  EntryOptions,
  EntryResult,
  FormField,
  AnalyzedField,
  FormAnalysis,
  FieldMapping,
  StepInfo,
  InstantWinResult,
  ConfirmationResult,
  EntryStrategy,
  EntryContext,
  EntryRecord,
  EntryLimitRecord,
  SelectOption,
  Page,
} from './types.js';

// Core orchestrator
export {
  EntryOrchestrator,
  type BrowserContextProvider,
  type BrowserContext,
} from './entry-orchestrator.js';

// Form analysis and filling
export { FormAnalyzer } from './form-analyzer.js';
export { FormFiller } from './form-filler.js';
export { FieldMapper } from './field-mapper.js';

// Specialized handlers
export { MultiStepHandler } from './multi-step-handler.js';
export { CheckboxHandler, type CheckboxOptions } from './checkbox-handler.js';
export { InstantWinHandler } from './instant-win-handler.js';
export { ConfirmationHandler } from './confirmation-handler.js';
export { EntryRecorder } from './entry-recorder.js';

// Strategies
export {
  selectStrategy,
  getAvailableStrategies,
  SimpleFormStrategy,
  MultiStepStrategy,
  InstantWinStrategy,
} from './strategies/index.js';
