import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useWinHistory } from '../../api/hooks';
import { LoadingSpinner } from '../shared/LoadingSpinner';

interface WinHistoryProps {
  dateRange?: { from: string; to: string };
}

export function WinHistory({ dateRange }: WinHistoryProps) {
  const { data, isLoading } = useWinHistory(dateRange);

  const chartData = data ?? [];

  return (
    <div className="card p-5">
      <h3 className="text-sm font-medium text-zinc-300">Win History</h3>
      <p className="text-xs text-zinc-500">Wins and prize values over time</p>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
          No win history data yet
        </div>
      ) : (
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#71717a', fontSize: 12 }}
              />
              <YAxis
                yAxisId="wins"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#71717a', fontSize: 12 }}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="value"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#71717a', fontSize: 12 }}
                tickFormatter={(val: number) => `$${val}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#fafafa',
                }}
                formatter={(value: number, name: string) => {
                  if (name === 'prizeValue') return [`$${value.toLocaleString()}`, 'Prize Value'];
                  return [value, 'Wins'];
                }}
              />
              <Bar
                yAxisId="wins"
                dataKey="wins"
                fill="#f59e0b"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
                name="wins"
              />
              <Bar
                yAxisId="value"
                dataKey="prizeValue"
                fill="#10b981"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
                opacity={0.5}
                name="prizeValue"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
