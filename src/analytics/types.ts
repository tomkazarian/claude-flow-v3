/**
 * Type definitions for the analytics module.
 */

// ---------------------------------------------------------------------------
// Date range
// ---------------------------------------------------------------------------

export interface DateRange {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Entry metrics
// ---------------------------------------------------------------------------

export interface EntryMetrics {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  avgDurationMs: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Cost metrics
// ---------------------------------------------------------------------------

export interface CostMetrics {
  total: number;
  byCaptcha: number;
  byProxy: number;
  bySms: number;
  bySocial: number;
  avgCostPerEntry: number;
  costPerWin: number;
}

// ---------------------------------------------------------------------------
// Discovery metrics
// ---------------------------------------------------------------------------

export interface DiscoveryMetrics {
  totalDiscovered: number;
  bySource: Record<string, number>;
  newToday: number;
  expiringToday: number;
}

// ---------------------------------------------------------------------------
// Win metrics
// ---------------------------------------------------------------------------

export interface WinMetrics {
  totalWins: number;
  totalValue: number;
  avgValue: number;
  byCategory: Record<string, number>;
  claimRate: number;
}

// ---------------------------------------------------------------------------
// Entry analytics
// ---------------------------------------------------------------------------

export interface DomainStats {
  domain: string;
  total: number;
  successful: number;
  failed: number;
  successRate: number;
}

export interface FailureReason {
  reason: string;
  count: number;
  percentage: number;
}

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
  label?: string;
}

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

export interface CostLogEntry {
  category: 'captcha' | 'proxy' | 'sms' | 'social';
  provider: string;
  amount: number;
  currency: string;
  entryId?: string;
  description?: string;
}

export interface CostBreakdown {
  total: number;
  captcha: { total: number; perSolve: number };
  proxy: { total: number; perRequest: number };
  sms: { total: number; perVerify: number };
  avgPerEntry: number;
  avgPerWin: number;
  roi: number;
}

// ---------------------------------------------------------------------------
// ROI
// ---------------------------------------------------------------------------

export interface ROIData {
  totalCost: number;
  totalWinValue: number;
  netProfit: number;
  roi: number;
  costPerEntry: number;
  costPerWin: number;
  avgWinValue: number;
  winRate: number;
  projectedMonthlyROI: number;
}

export interface ContestROI {
  contestId: string;
  contestTitle: string;
  totalCost: number;
  totalWinValue: number;
  netProfit: number;
  roi: number;
  entries: number;
  wins: number;
}

// ---------------------------------------------------------------------------
// Export filters
// ---------------------------------------------------------------------------

export interface EntryFilter {
  contestId?: string;
  profileId?: string;
  status?: string;
  from?: string;
  to?: string;
}

export interface ContestFilter {
  type?: string;
  status?: string;
  source?: string;
  from?: string;
  to?: string;
}

export interface WinFilter {
  profileId?: string;
  claimStatus?: string;
  from?: string;
  to?: string;
}
