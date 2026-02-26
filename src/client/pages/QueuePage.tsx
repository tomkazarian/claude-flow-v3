import { Pause, Play } from 'lucide-react';
import { useQueueStatus, usePauseQueue, useResumeQueue } from '../api/hooks';
import { useAppStore } from '../stores/app.store';
import { QueueDashboard } from '../components/queue/QueueDashboard';
import { JobList } from '../components/queue/JobList';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { toast } from '../stores/notification.store';

export function QueuePage() {
  const { data, isLoading } = useQueueStatus();
  const queuePaused = useAppStore((s) => s.queuePaused);
  const setQueuePaused = useAppStore((s) => s.setQueuePaused);
  const pauseQueue = usePauseQueue();
  const resumeQueue = useResumeQueue();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner message="Loading queue status..." />
      </div>
    );
  }

  const queues = data?.queues ?? [];
  const activeJobs = queues.filter((q) => q.active > 0);
  const failedQueues = queues.filter((q) => q.failed > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Queue Management</h2>
          <p className="text-sm text-zinc-500">
            {data?.totalJobs ?? 0} total jobs | {data?.jobsPerMinute?.toFixed(1) ?? '0.0'} jobs/min
          </p>
        </div>
        <button
          onClick={() => {
            if (queuePaused) {
              resumeQueue.mutate('all', {
                onSuccess: () => { setQueuePaused(false); toast.success('Queues resumed'); },
                onError: (err) => toast.error('Resume failed', err.message),
              });
            } else {
              pauseQueue.mutate('all', {
                onSuccess: () => { setQueuePaused(true); toast.success('Queues paused'); },
                onError: (err) => toast.error('Pause failed', err.message),
              });
            }
          }}
          disabled={pauseQueue.isPending || resumeQueue.isPending}
          className={queuePaused ? 'btn-primary' : 'btn-secondary'}
        >
          {queuePaused ? (
            <>
              <Play className="h-4 w-4" />
              Resume All
            </>
          ) : (
            <>
              <Pause className="h-4 w-4" />
              Pause All
            </>
          )}
        </button>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">Total Jobs</p>
          <p className="mt-1 text-2xl font-bold text-zinc-100">{data?.totalJobs ?? 0}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">Completed</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{data?.totalCompleted ?? 0}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">Failed</p>
          <p className="mt-1 text-2xl font-bold text-rose-400">{data?.totalFailed ?? 0}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-xs text-zinc-500">Avg Processing</p>
          <p className="mt-1 text-2xl font-bold text-zinc-100">
            {data?.avgProcessingTimeMs ? `${(data.avgProcessingTimeMs / 1000).toFixed(1)}s` : '-'}
          </p>
        </div>
      </div>

      {/* Queue cards */}
      <QueueDashboard queues={queues} />

      {/* Active and failed job lists */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <JobList
          title="Active Jobs"
          jobs={activeJobs.map((q) => ({
            id: q.name,
            queue: q.name,
            status: 'active',
            data: { waiting: q.waiting, active: q.active },
            createdAt: new Date().toISOString(),
            attemptsMade: 1,
          }))}
        />
        <JobList
          title="Failed Jobs"
          jobs={failedQueues.map((q) => ({
            id: `${q.name}-failed`,
            queue: q.name,
            status: 'failed',
            data: { failed: q.failed },
            createdAt: new Date().toISOString(),
            failedReason: `${q.failed} jobs failed in ${q.name}`,
            attemptsMade: 1,
          }))}
          onRetry={() => {
            /* retry logic */
          }}
        />
      </div>
    </div>
  );
}
