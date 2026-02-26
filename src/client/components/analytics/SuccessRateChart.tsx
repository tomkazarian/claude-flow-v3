import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useSuccessRateTimeSeries } from '../../api/hooks';
import { LoadingSpinner } from '../shared/LoadingSpinner';

interface SuccessRateChartProps {
  dateRange?: { from: string; to: string };
}

export function SuccessRateChart({ dateRange }: SuccessRateChartProps) {
  const { data, isLoading } = useSuccessRateTimeSeries(dateRange);

  const chartData = data ?? [
    { date: '2026-02-20', rate: 0.82 },
    { date: '2026-02-21', rate: 0.85 },
    { date: '2026-02-22', rate: 0.79 },
    { date: '2026-02-23', rate: 0.88 },
    { date: '2026-02-24', rate: 0.91 },
    { date: '2026-02-25', rate: 0.87 },
    { date: '2026-02-26', rate: 0.90 },
  ];

  return (
    <div className="card p-5">
      <h3 className="text-sm font-medium text-zinc-300">Success Rate Over Time</h3>
      <p className="text-xs text-zinc-500">Entry success percentage</p>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      ) : (
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#71717a', fontSize: 12 }}
                tickFormatter={(val: string) => {
                  const d = new Date(val + 'T00:00:00');
                  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#71717a', fontSize: 12 }}
                tickFormatter={(val: number) => `${(val * 100).toFixed(0)}%`}
                domain={[0, 1]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#fafafa',
                }}
                formatter={(value: number) => [`${(value * 100).toFixed(1)}%`, 'Success Rate']}
                labelFormatter={(label: string) => {
                  const d = new Date(label + 'T00:00:00');
                  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                }}
              />
              <Line
                type="monotone"
                dataKey="rate"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ fill: '#10b981', r: 3 }}
                activeDot={{ fill: '#10b981', r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
