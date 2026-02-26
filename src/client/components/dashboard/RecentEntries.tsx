import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useEntries } from '../../api/hooks';
import { StatusBadge } from '../shared/StatusBadge';
import { LoadingSpinner } from '../shared/LoadingSpinner';

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function RecentEntries() {
  const navigate = useNavigate();
  const { data, isLoading } = useEntries({ limit: 10, orderBy: 'created_at', orderDirection: 'desc' });

  const entries = data?.data ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-700/50 px-5 py-4">
        <h3 className="text-sm font-medium text-zinc-300">Recent Entries</h3>
        <button
          onClick={() => navigate('/entries')}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-emerald-400"
        >
          View All
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      ) : entries.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-500">
          No entries yet. Contests will appear here after you start entering.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800/50">
                <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Contest</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Status</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Method</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Duration</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/30">
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="cursor-pointer transition-colors hover:bg-zinc-800/30"
                  onClick={() => navigate(`/entries?id=${entry.id}`)}
                >
                  <td className="max-w-[200px] truncate px-5 py-3 text-sm text-zinc-200">
                    {entry.contest?.title ?? entry.contestId}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={entry.status} />
                  </td>
                  <td className="px-5 py-3 text-sm text-zinc-400">
                    {entry.entryMethod ?? '-'}
                  </td>
                  <td className="px-5 py-3 text-sm font-mono text-zinc-400">
                    {formatDuration(entry.durationMs)}
                  </td>
                  <td className="px-5 py-3 text-right text-sm text-zinc-500">
                    {formatTimeAgo(entry.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
