import { useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { useEntries, useEntryStats, useRetryEntry } from '../api/hooks';
import { EntryLog } from '../components/entries/EntryLog';
import { EntryDetail } from '../components/entries/EntryDetail';
import { Pagination } from '../components/shared/Pagination';
import { toast } from '../stores/notification.store';
import type { EntryFilter, EntryWithContest } from '@/types/entry.types';

const PAGE_SIZE = 25;

export function EntriesPage() {
  const [filters, setFilters] = useState<EntryFilter>({
    limit: PAGE_SIZE,
    offset: 0,
    orderBy: 'created_at',
    orderDirection: 'desc',
  });
  const [selectedEntry, setSelectedEntry] = useState<EntryWithContest | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const effectiveFilters: EntryFilter = {
    ...filters,
    status: (statusFilter || undefined) as EntryFilter['status'],
  };

  const { data, isLoading } = useEntries(effectiveFilters);
  const { data: stats } = useEntryStats();
  const retryEntry = useRetryEntry();

  const handleRetry = useCallback(
    (entryId: string) => {
      retryEntry.mutate(entryId, {
        onSuccess: () => toast.success('Retry queued', 'The entry will be retried shortly.'),
        onError: (err) => toast.error('Retry failed', err.message),
      });
    },
    [retryEntry],
  );

  const handleExport = useCallback(() => {
    toast.info('Export started', 'Your data export is being prepared.');
  }, []);

  return (
    <div className="space-y-6">
      {/* Stats summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">Total Entries</p>
          <p className="mt-1 text-2xl font-bold text-zinc-100">{stats?.total ?? 0}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">Success Rate</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">
            {stats ? `${(stats.successRate * 100).toFixed(1)}%` : '0%'}
          </p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">Won</p>
          <p className="mt-1 text-2xl font-bold text-amber-400">{stats?.won ?? 0}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">CAPTCHA Cost</p>
          <p className="mt-1 text-2xl font-bold text-zinc-100">
            ${(stats?.totalCaptchaCost ?? 0).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setFilters((f) => ({ ...f, offset: 0 }));
          }}
          className="select-field w-40"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="submitted">Submitted</option>
          <option value="confirmed">Confirmed</option>
          <option value="failed">Failed</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="expired">Expired</option>
          <option value="duplicate">Duplicate</option>
        </select>

        <div className="flex-1" />

        <button onClick={handleExport} className="btn-secondary text-xs">
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>

      {/* Entry log */}
      <EntryLog
        entries={data?.data ?? []}
        loading={isLoading}
        onRetry={handleRetry}
        onRowClick={setSelectedEntry}
      />

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <Pagination
          total={data.total}
          limit={PAGE_SIZE}
          offset={filters.offset ?? 0}
          onPageChange={(offset) => setFilters((f) => ({ ...f, offset }))}
        />
      )}

      {/* Detail panel */}
      {selectedEntry && (
        <EntryDetail
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onRetry={handleRetry}
        />
      )}
    </div>
  );
}
