/**
 * Analytics module public API.
 */

export { MetricsCollector } from './metrics-collector.js';
export { EntryAnalytics } from './entry-analytics.js';
export { CostTracker } from './cost-tracker.js';
export { ROICalculator } from './roi-calculator.js';
export { ExportService } from './export-service.js';
export { TimeSeriesStore, timeSeriesMetrics } from './time-series.js';
export type {
  DateRange,
  EntryMetrics,
  CostMetrics,
  DiscoveryMetrics,
  WinMetrics,
  DomainStats,
  FailureReason,
  TimeSeriesPoint,
  CostLogEntry,
  CostBreakdown,
  ROIData,
  ContestROI,
  EntryFilter,
  ContestFilter,
  WinFilter,
} from './types.js';
