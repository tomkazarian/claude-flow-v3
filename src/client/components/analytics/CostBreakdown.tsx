import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { AnalyticsOverview } from '../../api/hooks';
import { LoadingSpinner } from '../shared/LoadingSpinner';

interface CostBreakdownProps {
  overview: AnalyticsOverview | undefined;
  loading?: boolean;
}

const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#71717a'];

const LABELS: Record<string, string> = {
  captcha: 'CAPTCHA',
  proxy: 'Proxy',
  sms: 'SMS',
  email: 'Email',
  other: 'Other',
};

export function CostBreakdown({ overview, loading }: CostBreakdownProps) {
  const breakdown = overview?.costBreakdown ?? {
    captcha: 0,
    proxy: 0,
    sms: 0,
    email: 0,
    other: 0,
  };

  const data = Object.entries(breakdown)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({
      name: LABELS[key] ?? key,
      value: Number(value.toFixed(2)),
    }));

  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="card p-5">
      <h3 className="text-sm font-medium text-zinc-300">Cost Breakdown</h3>
      <p className="text-xs text-zinc-500">
        Total: ${total.toFixed(2)}
      </p>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      ) : data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
          No cost data available
        </div>
      ) : (
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={3}
                dataKey="value"
                stroke="none"
              >
                {data.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#fafafa',
                }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, '']}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                iconType="circle"
                iconSize={8}
                formatter={(value: string) => (
                  <span style={{ color: '#a1a1aa', fontSize: '12px' }}>{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
