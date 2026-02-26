import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useEntryTimeSeries } from '../../api/hooks';
import { LoadingSpinner } from '../shared/LoadingSpinner';

export function ActivityChart() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateRange = {
    from: sevenDaysAgo.toISOString().split('T')[0] ?? '',
    to: new Date().toISOString().split('T')[0] ?? '',
  };

  const { data, isLoading } = useEntryTimeSeries(dateRange);

  const chartData = data ?? [
    { date: 'Mon', successful: 42, failed: 3 },
    { date: 'Tue', successful: 55, failed: 5 },
    { date: 'Wed', successful: 38, failed: 2 },
    { date: 'Thu', successful: 67, failed: 4 },
    { date: 'Fri', successful: 48, failed: 6 },
    { date: 'Sat', successful: 72, failed: 3 },
    { date: 'Sun', successful: 61, failed: 2 },
  ];

  return (
    <div className="card p-5">
      <h3 className="text-sm font-medium text-zinc-300">Entry Activity</h3>
      <p className="text-xs text-zinc-500">Last 7 days</p>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      ) : (
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#71717a', fontSize: 12 }}
                tickFormatter={(val: string) => {
                  if (val.includes('-')) {
                    const d = new Date(val + 'T00:00:00');
                    return d.toLocaleDateString('en-US', { weekday: 'short' });
                  }
                  return val;
                }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#71717a', fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#fafafa',
                }}
                labelStyle={{ color: '#a1a1aa' }}
              />
              <Area
                type="monotone"
                dataKey="successful"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#successGradient)"
                name="Successful"
              />
              <Area
                type="monotone"
                dataKey="failed"
                stroke="#f43f5e"
                strokeWidth={2}
                fill="url(#failedGradient)"
                name="Failed"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
