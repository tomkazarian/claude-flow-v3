import { RotateCcw, Trash2, Clock } from 'lucide-react';
import { StatusBadge } from '../shared/StatusBadge';
import { EmptyState } from '../shared/EmptyState';

interface Job {
  id: string;
  queue: string;
  status: string;
  data: Record<string, unknown>;
  createdAt: string;
  processedAt?: string;
  failedReason?: string;
  attemptsMade: number;
}

interface JobListProps {
  jobs: Job[];
  loading?: boolean;
  title: string;
  onRetry?: (jobId: string) => void;
  onDelete?: (jobId: string) => void;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function JobList({ jobs, loading, title, onRetry, onDelete }: JobListProps) {
  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin mx-auto h-6 w-6 rounded-full border-2 border-zinc-700 border-t-emerald-500" />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-zinc-700/50 px-5 py-3">
        <h3 className="text-sm font-medium text-zinc-300">{title}</h3>
        <p className="text-xs text-zinc-500">{jobs.length} jobs</p>
      </div>

      {jobs.length === 0 ? (
        <div className="py-8">
          <EmptyState title="No jobs" message="This queue is empty." />
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/30">
          {jobs.map((job) => (
            <div key={job.id} className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/20">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-zinc-400">{job.id.substring(0, 12)}</span>
                  <StatusBadge status={job.status} />
                  <span className="badge bg-zinc-800 text-zinc-500">{job.queue}</span>
                </div>

                {/* Data preview */}
                <p className="mt-1 truncate text-xs text-zinc-600">
                  {JSON.stringify(job.data).substring(0, 100)}
                </p>

                {/* Failed reason */}
                {job.failedReason && (
                  <p className="mt-1 text-xs text-rose-400">{job.failedReason}</p>
                )}

                <div className="mt-1 flex items-center gap-3 text-[10px] text-zinc-600">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatTimeAgo(job.createdAt)}
                  </span>
                  {job.attemptsMade > 1 && (
                    <span>Attempt {job.attemptsMade}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {onRetry && job.status === 'failed' && (
                  <button
                    onClick={() => onRetry(job.id)}
                    className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-700/50 hover:text-zinc-300"
                    title="Retry"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => onDelete(job.id)}
                    className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-700/50 hover:text-rose-400"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
