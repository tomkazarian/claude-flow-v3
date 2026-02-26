// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
  label?: string;
}

// ---------------------------------------------------------------------------
// Dashboard stats (top-level overview)
// ---------------------------------------------------------------------------

export interface DashboardStats {
  /** Total number of profiles */
  totalProfiles: number;

  /** Total number of active contests */
  activeContests: number;

  /** Total number of queued contests */
  queuedContests: number;

  /** Total entries ever submitted */
  totalEntries: number;

  /** Entries submitted today */
  entriesToday: number;

  /** Overall success rate (confirmed / total submitted) */
  successRate: number;

  /** Total wins detected */
  totalWins: number;

  /** Total claimed prize value in USD */
  totalPrizeValue: number;

  /** Total operational cost in USD */
  totalCost: number;

  /** Return on investment: (totalPrizeValue - totalCost) / totalCost */
  roi: number;

  /** Number of active discovery sources */
  activeDiscoverySources: number;

  /** Number of healthy proxies */
  healthyProxies: number;

  /** System uptime in milliseconds */
  uptimeMs: number;

  /** Last updated timestamp */
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Entry analytics
// ---------------------------------------------------------------------------

export interface EntryAnalytics {
  /** Total entries in the analyzed period */
  totalEntries: number;

  /** Breakdown by status */
  byStatus: Record<string, number>;

  /** Breakdown by entry method */
  byMethod: Record<string, number>;

  /** Breakdown by contest type */
  byContestType: Record<string, number>;

  /** Average duration in milliseconds */
  avgDurationMs: number;

  /** Median duration in milliseconds */
  medianDurationMs: number;

  /** 95th percentile duration in milliseconds */
  p95DurationMs: number;

  /** Captcha solve rate */
  captchaSolveRate: number;

  /** Email confirmation rate */
  emailConfirmRate: number;

  /** Entries over time */
  entriesOverTime: TimeSeriesPoint[];

  /** Success rate over time */
  successRateOverTime: TimeSeriesPoint[];
}

// ---------------------------------------------------------------------------
// Cost breakdown
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  /** Total cost in the analyzed period */
  totalCost: number;

  /** Cost by category */
  byCategory: {
    captcha: number;
    proxy: number;
    sms: number;
    social: number;
  };

  /** Cost by provider within each category */
  byProvider: Record<string, number>;

  /** Average cost per entry */
  avgCostPerEntry: number;

  /** Average cost per successful entry */
  avgCostPerSuccess: number;

  /** Average captcha cost per solve */
  avgCaptchaCost: number;

  /** Daily cost trend */
  dailyCosts: TimeSeriesPoint[];

  /** Cumulative cost over time */
  cumulativeCost: TimeSeriesPoint[];

  /** Budget remaining (null if no budget set) */
  budgetRemaining: number | null;

  /** Projected monthly cost based on current rate */
  projectedMonthlyCost: number;
}

// ---------------------------------------------------------------------------
// Win summary
// ---------------------------------------------------------------------------

export interface WinSummary {
  /** Total wins detected */
  totalWins: number;

  /** Total prize value across all wins */
  totalPrizeValue: number;

  /** Breakdown by claim status */
  byClaimStatus: Record<string, number>;

  /** Breakdown by prize category */
  byPrizeCategory: Record<string, number>;

  /** Wins over time */
  winsOverTime: TimeSeriesPoint[];

  /** Prize value over time */
  prizeValueOverTime: TimeSeriesPoint[];

  /** Average prize value */
  avgPrizeValue: number;

  /** Largest single prize value */
  maxPrizeValue: number;

  /** Win rate (wins / total confirmed entries) */
  winRate: number;

  /** Pending claims requiring action */
  pendingClaims: PendingClaim[];
}

export interface PendingClaim {
  winId: string;
  contestTitle: string;
  prizeDescription: string;
  prizeValue: number | null;
  claimDeadline: string | null;
  claimUrl: string | null;
  detectedAt: string;
}

// ---------------------------------------------------------------------------
// ROI data
// ---------------------------------------------------------------------------

export interface ROIData {
  /** Total revenue (claimed prize value) */
  totalRevenue: number;

  /** Total cost (captcha + proxy + sms + social) */
  totalCost: number;

  /** Net profit (revenue - cost) */
  netProfit: number;

  /** ROI percentage ((revenue - cost) / cost * 100) */
  roiPercent: number;

  /** Revenue per entry */
  revenuePerEntry: number;

  /** Cost per entry */
  costPerEntry: number;

  /** Profit per entry */
  profitPerEntry: number;

  /** Monthly ROI trend */
  monthlyROI: TimeSeriesPoint[];

  /** ROI by contest type */
  roiByContestType: Record<string, number>;

  /** ROI by entry method */
  roiByEntryMethod: Record<string, number>;

  /** Break-even point: entries needed to cover costs */
  breakEvenEntries: number;
}
