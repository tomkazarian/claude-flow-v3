import { useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { Bell, Radar, Pause, Play } from 'lucide-react';
import { useAppStore } from '../../stores/app.store';
import { useTriggerDiscovery, usePauseQueue, useResumeQueue } from '../../api/hooks';
import { toast } from '../../stores/notification.store';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/contests': 'Contests',
  '/entries': 'Entries',
  '/profiles': 'Profiles',
  '/queue': 'Queue',
  '/analytics': 'Analytics',
  '/status': 'Status',
  '/settings': 'Settings',
};

export function Header() {
  const location = useLocation();
  const title = pageTitles[location.pathname] ?? 'SweepFlow';
  const systemStatus = useAppStore((s) => s.systemStatus);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const queuePaused = useAppStore((s) => s.queuePaused);
  const setQueuePaused = useAppStore((s) => s.setQueuePaused);
  const triggerDiscovery = useTriggerDiscovery();
  const pauseQueue = usePauseQueue();
  const resumeQueue = useResumeQueue();

  const statusColors: Record<string, string> = {
    healthy: 'bg-emerald-400',
    degraded: 'bg-yellow-400',
    error: 'bg-rose-400',
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 backdrop-blur-sm">
      <h1 className="text-xl font-semibold text-zinc-100">{title}</h1>

      <div className="flex items-center gap-3">
        {/* Discovery button */}
        <button
          onClick={() => triggerDiscovery.mutate(undefined)}
          disabled={triggerDiscovery.isPending}
          className="btn-secondary text-xs"
        >
          <Radar className={clsx('h-4 w-4', triggerDiscovery.isPending && 'animate-spin')} />
          {triggerDiscovery.isPending ? 'Running...' : 'Run Discovery'}
        </button>

        {/* Queue toggle */}
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
          className={clsx(
            'btn-secondary text-xs',
            queuePaused && 'border-yellow-600/50 text-yellow-400',
          )}
        >
          {queuePaused ? (
            <>
              <Play className="h-4 w-4" />
              Resume Queue
            </>
          ) : (
            <>
              <Pause className="h-4 w-4" />
              Pause Queue
            </>
          )}
        </button>

        {/* Notifications */}
        <button className="relative rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {/* System status */}
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-1.5">
          <span
            className={clsx(
              'h-2 w-2 rounded-full',
              statusColors[systemStatus] ?? 'bg-zinc-500',
              systemStatus === 'healthy' && 'animate-pulse',
            )}
          />
          <span className="text-xs capitalize text-zinc-400">{systemStatus}</span>
        </div>
      </div>
    </header>
  );
}
