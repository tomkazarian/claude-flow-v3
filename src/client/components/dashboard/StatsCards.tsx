import { clsx } from 'clsx';
import { Send, TrendingUp, Trophy as TrophyIcon, Award, ArrowUp, ArrowDown } from 'lucide-react';
import type { DashboardStats } from '../../api/hooks';

interface StatsCardsProps {
  stats: DashboardStats | undefined;
  loading?: boolean;
}

export function StatsCards({ stats, loading }: StatsCardsProps) {
  const cards = [
    {
      label: 'Entries Today',
      value: stats?.entriesToday ?? 0,
      icon: Send,
      iconColor: 'text-blue-400',
      iconBg: 'bg-blue-500/10',
      trend: stats
        ? {
            value: stats.entriesToday - stats.entriesYesterday,
            label: 'vs yesterday',
          }
        : null,
    },
    {
      label: 'Success Rate',
      value: stats ? `${(stats.successRate * 100).toFixed(1)}%` : '0%',
      icon: TrendingUp,
      iconColor: 'text-emerald-400',
      iconBg: 'bg-emerald-500/10',
      trend: null,
    },
    {
      label: 'Active Contests',
      value: stats?.activeContests ?? 0,
      icon: TrophyIcon,
      iconColor: 'text-violet-400',
      iconBg: 'bg-violet-500/10',
      trend: null,
    },
    {
      label: 'Total Wins',
      value: stats?.totalWins ?? 0,
      icon: Award,
      iconColor: 'text-amber-400',
      iconBg: 'bg-amber-500/10',
      subtitle: stats?.totalPrizeValue
        ? `$${stats.totalPrizeValue.toLocaleString()} in prizes`
        : undefined,
      trend: null,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className={clsx(
              'card p-5 transition-colors hover:border-zinc-600/50',
              loading && 'animate-pulse',
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm text-zinc-500">{card.label}</p>
                <p className="mt-2 text-3xl font-bold text-zinc-100">
                  {loading ? (
                    <span className="inline-block h-8 w-20 rounded bg-zinc-700/50" />
                  ) : (
                    card.value
                  )}
                </p>
                {card.subtitle && !loading && (
                  <p className="mt-1 text-xs text-zinc-500">{card.subtitle}</p>
                )}
                {card.trend && !loading && (
                  <div className="mt-2 flex items-center gap-1">
                    {card.trend.value >= 0 ? (
                      <ArrowUp className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <ArrowDown className="h-3 w-3 text-rose-400" />
                    )}
                    <span
                      className={clsx(
                        'text-xs font-medium',
                        card.trend.value >= 0 ? 'text-emerald-400' : 'text-rose-400',
                      )}
                    >
                      {Math.abs(card.trend.value)}
                    </span>
                    <span className="text-xs text-zinc-600">{card.trend.label}</span>
                  </div>
                )}
              </div>
              <div className={clsx('rounded-lg p-2.5', card.iconBg)}>
                <Icon className={clsx('h-5 w-5', card.iconColor)} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
