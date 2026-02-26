/**
 * Real-time Status Monitor page.
 * Shows live system health, active entries, queue depths,
 * browser sessions, and a scrolling event feed.
 */

import { clsx } from 'clsx';
import {
  Activity,
  Wifi,
  WifiOff,
  RefreshCw,
  Monitor,
  Globe,
  Shield,
  Cpu,
  HardDrive,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Send,
  Search,
  Trophy,
  Pause,
  ArrowUpCircle,
} from 'lucide-react';
import { useStatusStream } from '../hooks/useStatusStream';
import type { SystemStatus, StatusEvent } from '../hooks/useStatusStream';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// -- Connection indicator --
function ConnectionBadge({ connected, error, onReconnect }: {
  connected: boolean;
  error: string | null;
  onReconnect: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={clsx(
        'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium',
        connected
          ? 'bg-emerald-500/10 text-emerald-400'
          : 'bg-rose-500/10 text-rose-400',
      )}>
        {connected ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <Wifi className="h-3.5 w-3.5" />
            Live
          </>
        ) : (
          <>
            <WifiOff className="h-3.5 w-3.5" />
            {error ?? 'Disconnected'}
          </>
        )}
      </div>
      {!connected && (
        <button
          onClick={onReconnect}
          className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          title="Reconnect"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// -- Metric card --
function MetricCard({ icon: Icon, label, value, sub, color = 'zinc' }: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  sub?: string;
  color?: 'emerald' | 'rose' | 'amber' | 'blue' | 'purple' | 'zinc';
}) {
  const colorMap = {
    emerald: 'bg-emerald-500/10 text-emerald-400',
    rose: 'bg-rose-500/10 text-rose-400',
    amber: 'bg-amber-500/10 text-amber-400',
    blue: 'bg-blue-500/10 text-blue-400',
    purple: 'bg-purple-500/10 text-purple-400',
    zinc: 'bg-zinc-700/30 text-zinc-400',
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-3">
        <div className={clsx('rounded-lg p-2', colorMap[color])}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-zinc-500">{label}</p>
          <p className="text-lg font-semibold text-zinc-100">{value}</p>
          {sub && <p className="text-xs text-zinc-500">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// -- Queue bar --
function QueueBar({ queue }: { queue: SystemStatus['queues'][number] }) {
  const total = queue.waiting + queue.active;
  const maxBar = 50;
  const waitingWidth = total > 0 ? Math.min((queue.waiting / maxBar) * 100, 100) : 0;
  const activeWidth = total > 0 ? Math.min((queue.active / maxBar) * 100, 100) : 0;

  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-xs font-medium text-zinc-300">{queue.name}</div>
      <div className="flex-1">
        <div className="flex h-3 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="bg-blue-500 transition-all duration-500"
            style={{ width: `${activeWidth}%` }}
          />
          <div
            className="bg-amber-500/60 transition-all duration-500"
            style={{ width: `${waitingWidth}%` }}
          />
        </div>
      </div>
      <div className="flex w-32 items-center gap-2 text-xs text-zinc-500">
        <span className="text-blue-400">{queue.active}a</span>
        <span className="text-amber-400">{queue.waiting}w</span>
        <span className="text-emerald-400">{queue.completed}d</span>
        <span className="text-rose-400">{queue.failed}f</span>
      </div>
      {queue.paused && (
        <Pause className="h-3.5 w-3.5 text-yellow-500" />
      )}
    </div>
  );
}

// -- Memory gauge --
function MemoryGauge({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  const color = pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-zinc-500">
        <span>Heap</span>
        <span>{formatBytes(used)} / {formatBytes(total)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={clsx('h-full transition-all duration-500 rounded-full', color)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

// -- Event icon/color mapping --
const eventConfig: Record<string, { icon: typeof Activity; color: string; bg: string }> = {
  entry_started: { icon: Send, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  entry_completed: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  entry_failed: { icon: XCircle, color: 'text-rose-400', bg: 'bg-rose-500/10' },
  captcha_solved: { icon: Shield, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  captcha_failed: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  win_detected: { icon: Trophy, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  discovery_complete: { icon: Search, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  error: { icon: XCircle, color: 'text-rose-400', bg: 'bg-rose-500/10' },
  queue_paused: { icon: Pause, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  queue_resumed: { icon: ArrowUpCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
};

function EventRow({ event }: { event: StatusEvent }) {
  const cfg = eventConfig[event.type] ?? { icon: Activity, color: 'text-zinc-400', bg: 'bg-zinc-700/30' };
  const Icon = cfg.icon;

  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-zinc-800/30">
      <div className={clsx('mt-0.5 rounded-md p-1.5', cfg.bg)}>
        <Icon className={clsx('h-3.5 w-3.5', cfg.color)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-300">{event.message}</p>
        <p className="text-xs text-zinc-600">{formatTimeAgo(event.timestamp)}</p>
      </div>
    </div>
  );
}

// -- Main page --
export function StatusPage() {
  const { status, events, connected, error, reconnect } = useStatusStream();

  const reversedEvents = [...events].reverse();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-500/10 p-2">
            <Activity className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Status Monitor</h1>
            <p className="text-sm text-zinc-500">Real-time system health and activity</p>
          </div>
        </div>
        <ConnectionBadge connected={connected} error={error} onReconnect={reconnect} />
      </div>

      {!status ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50">
          <div className="text-center">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-zinc-600" />
            <p className="mt-3 text-sm text-zinc-500">Connecting to status stream...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Top metrics row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              icon={Clock}
              label="Uptime"
              value={formatUptime(status.uptime)}
              color="blue"
            />
            <MetricCard
              icon={Send}
              label="Active Entries"
              value={status.entries.active}
              sub={`${status.entries.completedToday} done today`}
              color="emerald"
            />
            <MetricCard
              icon={Zap}
              label="Success Rate"
              value={`${status.entries.successRate}%`}
              sub={`${status.entries.failedToday} failed`}
              color={status.entries.successRate >= 70 ? 'emerald' : status.entries.successRate >= 40 ? 'amber' : 'rose'}
            />
            <MetricCard
              icon={Monitor}
              label="Browsers"
              value={`${status.browsers.active}/${status.browsers.max}`}
              sub={`${status.browsers.available} free`}
              color="purple"
            />
            <MetricCard
              icon={Shield}
              label="CAPTCHAs"
              value={status.captcha.solvedToday}
              sub={status.captcha.provider ?? 'no provider'}
              color="purple"
            />
            <MetricCard
              icon={Globe}
              label="Proxies"
              value={`${status.proxies.healthy}/${status.proxies.total}`}
              sub={status.proxies.unhealthy > 0 ? `${status.proxies.unhealthy} down` : 'all healthy'}
              color={status.proxies.unhealthy > 0 ? 'amber' : 'emerald'}
            />
          </div>

          {/* Main grid: queues + system | event feed */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

            {/* Left column: Queues + System */}
            <div className="space-y-6 lg:col-span-2">

              {/* Queue depths */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h2 className="mb-4 text-sm font-semibold text-zinc-300">Queue Depths</h2>
                <div className="space-y-3">
                  {status.queues.length > 0 ? (
                    status.queues.map((q) => <QueueBar key={q.name} queue={q} />)
                  ) : (
                    <p className="text-sm text-zinc-600">No queues detected (Redis may be offline)</p>
                  )}
                </div>
                <div className="mt-3 flex gap-4 text-xs text-zinc-600">
                  <span><span className="inline-block h-2 w-2 rounded-full bg-blue-500" /> active</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> waiting</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> done</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> failed</span>
                </div>
              </div>

              {/* System resources */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Memory */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-zinc-500" />
                    <h2 className="text-sm font-semibold text-zinc-300">Memory</h2>
                  </div>
                  <MemoryGauge used={status.memory.heapUsed} total={status.memory.heapTotal} />
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-500">
                    <div>
                      <p>RSS</p>
                      <p className="font-medium text-zinc-300">{formatBytes(status.memory.rss)}</p>
                    </div>
                    <div>
                      <p>External</p>
                      <p className="font-medium text-zinc-300">{formatBytes(status.memory.external)}</p>
                    </div>
                  </div>
                </div>

                {/* Discovery + Entry stats */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-zinc-500" />
                    <h2 className="text-sm font-semibold text-zinc-300">Discovery</h2>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Active Sources</span>
                      <span className="font-medium text-zinc-300">{status.discovery.activeSources}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Contests Found</span>
                      <span className="font-medium text-zinc-300">{status.discovery.contestsFound}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Last Discovery</span>
                      <span className="font-medium text-zinc-300">
                        {status.discovery.lastRunAt ? formatTimeAgo(status.discovery.lastRunAt) : 'never'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Avg Entry Time</span>
                      <span className="font-medium text-zinc-300">
                        {status.entries.avgDurationMs > 0
                          ? `${(status.entries.avgDurationMs / 1000).toFixed(1)}s`
                          : '--'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right column: Live event feed */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
                <h2 className="text-sm font-semibold text-zinc-300">Live Activity</h2>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                  {events.length} events
                </span>
              </div>
              <div className="h-[480px] overflow-y-auto p-2">
                {reversedEvents.length > 0 ? (
                  <div className="space-y-1">
                    {reversedEvents.map((event) => (
                      <EventRow key={event.id} event={event} />
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <Activity className="mx-auto h-8 w-8 text-zinc-700" />
                      <p className="mt-2 text-sm text-zinc-600">Waiting for activity...</p>
                      <p className="text-xs text-zinc-700">Events will appear here in real-time</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
