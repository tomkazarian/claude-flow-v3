import { clsx } from 'clsx';
import { Pause, Play } from 'lucide-react';
import { useQueueStatus, usePauseQueue, useResumeQueue } from '../../api/hooks';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import type { QueueStatus as QueueStatusType } from '@/types/queue.types';

function getDepthColor(depth: number): string {
  if (depth >= 50) return 'bg-rose-500';
  if (depth >= 10) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

function getDepthTextColor(depth: number): string {
  if (depth >= 50) return 'text-rose-400';
  if (depth >= 10) return 'text-yellow-400';
  return 'text-emerald-400';
}

function QueueRow({ queue }: { queue: QueueStatusType }) {
  const pauseQueue = usePauseQueue();
  const resumeQueue = useResumeQueue();
  const depth = queue.waiting + queue.active;
  const maxDepth = 100;
  const barWidth = Math.min((depth / maxDepth) * 100, 100);

  const handleToggle = () => {
    if (queue.paused) {
      resumeQueue.mutate(queue.name);
    } else {
      pauseQueue.mutate(queue.name);
    }
  };

  return (
    <div className="flex items-center gap-3 py-2.5">
      <button
        onClick={handleToggle}
        className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-700/50 hover:text-zinc-300"
        title={queue.paused ? 'Resume' : 'Pause'}
      >
        {queue.paused ? (
          <Play className="h-3.5 w-3.5 text-yellow-400" />
        ) : (
          <Pause className="h-3.5 w-3.5" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={clsx('text-xs font-medium', queue.paused ? 'text-yellow-400' : 'text-zinc-300')}>
            {queue.name}
          </span>
          <span className={clsx('text-xs font-mono', getDepthTextColor(depth))}>
            {depth}
          </span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-zinc-800">
          <div
            className={clsx('h-full rounded-full transition-all', getDepthColor(depth))}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function QueueStatusWidget() {
  const { data, isLoading } = useQueueStatus();

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-zinc-300">Queue Status</h3>
          <p className="text-xs text-zinc-500">
            {data ? `${data.totalJobs} total jobs` : 'Loading...'}
          </p>
        </div>
        {data && (
          <span className="text-xs text-zinc-500">
            {data.jobsPerMinute.toFixed(1)} jobs/min
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <LoadingSpinner size="sm" />
        </div>
      ) : (
        <div className="mt-4 divide-y divide-zinc-800/50">
          {(data?.queues ?? []).map((queue) => (
            <QueueRow key={queue.name} queue={queue} />
          ))}
          {(!data?.queues || data.queues.length === 0) && (
            <p className="py-8 text-center text-sm text-zinc-500">No queues active</p>
          )}
        </div>
      )}
    </div>
  );
}
