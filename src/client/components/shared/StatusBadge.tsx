import { clsx } from 'clsx';

type BadgeSize = 'sm' | 'md';

interface StatusBadgeProps {
  status: string;
  size?: BadgeSize;
  className?: string;
}

const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
  pending: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  submitted: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  confirmed: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  failed: { bg: 'bg-rose-500/10', text: 'text-rose-400', dot: 'bg-rose-400' },
  won: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  lost: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', dot: 'bg-zinc-500' },
  expired: { bg: 'bg-zinc-500/10', text: 'text-zinc-500', dot: 'bg-zinc-600' },
  duplicate: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', dot: 'bg-zinc-500' },
  active: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  discovered: { bg: 'bg-sky-500/10', text: 'text-sky-400', dot: 'bg-sky-400' },
  queued: { bg: 'bg-violet-500/10', text: 'text-violet-400', dot: 'bg-violet-400' },
  blocked: { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
  invalid: { bg: 'bg-orange-500/10', text: 'text-orange-400', dot: 'bg-orange-400' },
  completed: { bg: 'bg-zinc-500/10', text: 'text-zinc-400', dot: 'bg-zinc-400' },
  healthy: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  degraded: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  dead: { bg: 'bg-red-500/10', text: 'text-red-400', dot: 'bg-red-400' },
  unknown: { bg: 'bg-zinc-500/10', text: 'text-zinc-500', dot: 'bg-zinc-500' },
  paused: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', dot: 'bg-yellow-400' },
};

const defaultColors = { bg: 'bg-zinc-500/10', text: 'text-zinc-400', dot: 'bg-zinc-500' };

export function StatusBadge({ status, size = 'sm', className }: StatusBadgeProps) {
  const colors = statusColors[status] ?? defaultColors;

  return (
    <span
      className={clsx(
        'badge',
        colors.bg,
        colors.text,
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        className,
      )}
    >
      <span className={clsx('inline-block h-1.5 w-1.5 rounded-full', colors.dot)} />
      {status}
    </span>
  );
}
