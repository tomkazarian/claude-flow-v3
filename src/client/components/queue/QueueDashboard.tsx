import { clsx } from 'clsx';
import { Pause, Play, Activity } from 'lucide-react';
import { usePauseQueue, useResumeQueue } from '../../api/hooks';
import type { QueueStatus } from '@/types/queue.types';

interface QueueDashboardProps {
  queues: QueueStatus[];
}

function QueueCard({ queue }: { queue: QueueStatus }) {
  const pauseQueue = usePauseQueue();
  const resumeQueue = useResumeQueue();

  const total = queue.waiting + queue.active + queue.completed + queue.failed;

  const handleToggle = () => {
    if (queue.paused) {
      resumeQueue.mutate(queue.name);
    } else {
      pauseQueue.mutate(queue.name);
    }
  };

  return (
    <div className={clsx('card p-4', queue.paused && 'border-yellow-600/30 opacity-75')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className={clsx('h-4 w-4', queue.active > 0 ? 'text-emerald-400' : 'text-zinc-600')} />
          <h4 className="text-sm font-medium text-zinc-200">{queue.name}</h4>
        </div>
        <button
          onClick={handleToggle}
          className={clsx(
            'rounded p-1.5 transition-colors hover:bg-zinc-700/50',
            queue.paused ? 'text-yellow-400' : 'text-zinc-500 hover:text-zinc-300',
          )}
          title={queue.paused ? 'Resume' : 'Pause'}
        >
          {queue.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <div>
          <p className="text-lg font-semibold text-blue-400">{queue.waiting}</p>
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">Waiting</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-emerald-400">{queue.active}</p>
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">Active</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-zinc-300">{queue.completed}</p>
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">Done</p>
        </div>
        <div>
          <p className={clsx('text-lg font-semibold', queue.failed > 0 ? 'text-rose-400' : 'text-zinc-600')}>
            {queue.failed}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">Failed</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-800">
        {total > 0 && (
          <div className="flex h-full">
            <div
              className="bg-emerald-500"
              style={{ width: `${(queue.completed / total) * 100}%` }}
            />
            <div
              className="bg-blue-500"
              style={{ width: `${(queue.active / total) * 100}%` }}
            />
            <div
              className="bg-rose-500"
              style={{ width: `${(queue.failed / total) * 100}%` }}
            />
          </div>
        )}
      </div>

      {queue.paused && (
        <p className="mt-2 text-center text-[10px] font-medium uppercase tracking-wider text-yellow-500">
          Paused
        </p>
      )}
    </div>
  );
}

export function QueueDashboard({ queues }: QueueDashboardProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {queues.map((queue) => (
        <QueueCard key={queue.name} queue={queue} />
      ))}
    </div>
  );
}
