import { useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { StatusBadge } from '../shared/StatusBadge';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import { EmptyState } from '../shared/EmptyState';
import type { EntryWithContest } from '@/types/entry.types';

interface EntryLogProps {
  entries: EntryWithContest[];
  loading?: boolean;
  onRetry: (entryId: string) => void;
  onRowClick: (entry: EntryWithContest) => void;
}

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

function EntryRow({
  entry,
  onRetry,
  onRowClick,
}: {
  entry: EntryWithContest;
  onRetry: (id: string) => void;
  onRowClick: (entry: EntryWithContest) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasFailed = entry.status === 'failed';

  return (
    <>
      <tr
        className="cursor-pointer transition-colors hover:bg-zinc-800/30"
        onClick={() => onRowClick(entry)}
      >
        <td className="px-4 py-3">
          {hasFailed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="text-zinc-500 hover:text-zinc-300"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          )}
        </td>
        <td className="max-w-[250px] truncate px-4 py-3 text-sm text-zinc-200">
          {entry.contest?.title ?? entry.contestId}
        </td>
        <td className="px-4 py-3 text-sm text-zinc-400">
          {entry.profileId.substring(0, 8)}...
        </td>
        <td className="px-4 py-3">
          <StatusBadge status={entry.status} />
        </td>
        <td className="px-4 py-3 text-sm text-zinc-400">
          {entry.entryMethod ?? '-'}
        </td>
        <td className="px-4 py-3 text-sm font-mono text-zinc-400">
          {formatDuration(entry.durationMs)}
        </td>
        <td className="px-4 py-3 text-center">
          {entry.captchaSolved ? (
            <span className="text-xs text-emerald-400">Yes</span>
          ) : (
            <span className="text-xs text-zinc-600">-</span>
          )}
        </td>
        <td className="px-4 py-3 text-right text-sm text-zinc-500">
          {formatTimeAgo(entry.createdAt)}
        </td>
      </tr>

      {/* Expanded error row */}
      {expanded && hasFailed && (
        <tr className="bg-rose-500/5">
          <td colSpan={8} className="px-4 py-3">
            <div className="flex items-start justify-between gap-4 pl-8">
              <div>
                <p className="text-xs font-medium text-rose-400">Error</p>
                <p className="mt-1 text-xs text-zinc-400">
                  {entry.errorMessage ?? 'Unknown error'}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(entry.id);
                }}
                className="btn-secondary shrink-0 text-xs"
              >
                <RotateCcw className="h-3 w-3" />
                Retry
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function EntryLog({ entries, loading, onRetry, onRowClick }: EntryLogProps) {
  if (loading) {
    return (
      <div className="card flex items-center justify-center py-20">
        <LoadingSpinner message="Loading entries..." />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="card">
        <EmptyState title="No entries found" message="Adjust your filters or enter some contests." />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-700/50">
              <th className="w-10 px-4 py-3" />
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Contest</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Profile</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Method</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Duration</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">CAPTCHA</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/30">
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                onRetry={onRetry}
                onRowClick={onRowClick}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
