import { useDashboardStats } from '../api/hooks';
import { StatsCards } from '../components/dashboard/StatsCards';
import { WinBanner } from '../components/dashboard/WinBanner';
import { ActivityChart } from '../components/dashboard/ActivityChart';
import { QueueStatusWidget } from '../components/dashboard/QueueStatus';
import { RecentEntries } from '../components/dashboard/RecentEntries';

export function DashboardPage() {
  const { data: stats, isLoading } = useDashboardStats();

  return (
    <div className="space-y-6">
      <StatsCards stats={stats} loading={isLoading} />

      <WinBanner stats={stats} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActivityChart />
        </div>
        <div>
          <QueueStatusWidget />
        </div>
      </div>

      <RecentEntries />
    </div>
  );
}
