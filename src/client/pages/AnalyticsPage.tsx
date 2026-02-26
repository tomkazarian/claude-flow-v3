import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { useAnalyticsOverview } from '../api/hooks';
import { AnalyticsDashboard } from '../components/analytics/AnalyticsDashboard';

function getDefaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().split('T')[0] ?? '',
    to: to.toISOString().split('T')[0] ?? '',
  };
}

export function AnalyticsPage() {
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const { data: overview, isLoading } = useAnalyticsOverview(dateRange);

  return (
    <div className="space-y-6">
      {/* Header with date range */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Analytics</h2>
          <p className="text-sm text-zinc-500">Performance overview and insights</p>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-zinc-500" />
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => setDateRange((prev) => ({ ...prev, from: e.target.value }))}
            className="input-field w-36 text-xs"
          />
          <span className="text-xs text-zinc-600">to</span>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => setDateRange((prev) => ({ ...prev, to: e.target.value }))}
            className="input-field w-36 text-xs"
          />
          <button
            onClick={() => setDateRange(getDefaultDateRange())}
            className="btn-ghost text-xs"
          >
            Last 30 days
          </button>
        </div>
      </div>

      <AnalyticsDashboard
        overview={overview}
        dateRange={dateRange}
        loading={isLoading}
      />
    </div>
  );
}
