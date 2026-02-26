import { SuccessRateChart } from './SuccessRateChart';
import { CostBreakdown } from './CostBreakdown';
import { WinHistory } from './WinHistory';
import type { AnalyticsOverview } from '../../api/hooks';

interface AnalyticsDashboardProps {
  overview: AnalyticsOverview | undefined;
  dateRange?: { from: string; to: string };
  loading?: boolean;
}

export function AnalyticsDashboard({ overview, dateRange, loading }: AnalyticsDashboardProps) {
  const roi = overview?.roi ?? 0;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">Total Entries</p>
          <p className="mt-1 text-2xl font-bold text-zinc-100">{overview?.totalEntries ?? 0}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">Success Rate</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">
            {overview ? `${(overview.successRate * 100).toFixed(1)}%` : '0%'}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">Total Wins</p>
          <p className="mt-1 text-2xl font-bold text-amber-400">{overview?.totalWins ?? 0}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">Total Cost</p>
          <p className="mt-1 text-2xl font-bold text-zinc-100">
            ${(overview?.totalCost ?? 0).toFixed(2)}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">ROI</p>
          <p className={`mt-1 text-2xl font-bold ${roi >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {roi >= 0 ? '+' : ''}{(roi * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SuccessRateChart dateRange={dateRange} />
        <CostBreakdown overview={overview} loading={loading} />
      </div>

      <WinHistory dateRange={dateRange} />

      {/* Top sources table */}
      {overview?.topSources && overview.topSources.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-zinc-700/50 px-5 py-4">
            <h3 className="text-sm font-medium text-zinc-300">Top Performing Sources</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800/50">
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Source</th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">Entries</th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">Wins</th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">Success Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/30">
                {overview.topSources.map((source) => (
                  <tr key={source.source} className="hover:bg-zinc-800/20">
                    <td className="px-5 py-3 text-sm text-zinc-200">{source.source}</td>
                    <td className="px-5 py-3 text-right text-sm text-zinc-400">{source.entries}</td>
                    <td className="px-5 py-3 text-right text-sm text-amber-400">{source.wins}</td>
                    <td className="px-5 py-3 text-right text-sm text-emerald-400">
                      {(source.successRate * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
