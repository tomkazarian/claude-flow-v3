import { useState } from 'react';
import { Award, X, ExternalLink } from 'lucide-react';
import type { DashboardStats } from '../../api/hooks';

interface WinBannerProps {
  stats: DashboardStats | undefined;
}

export function WinBanner({ stats }: WinBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!stats?.recentWin || dismissed) return null;

  const win = stats.recentWin;
  const wonDate = new Date(win.wonAt);
  const hoursAgo = Math.floor((Date.now() - wonDate.getTime()) / (1000 * 60 * 60));

  if (hoursAgo > 24) return null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-400/5 to-transparent p-5">
      {/* Subtle glow effect */}
      <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-amber-500/5 blur-3xl" />

      <div className="relative flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="animate-pulse-glow flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20">
            <Award className="h-6 w-6 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-amber-300">You won!</h3>
              <span className="text-xs text-zinc-500">{hoursAgo}h ago</span>
            </div>
            <p className="mt-0.5 text-sm text-zinc-300">
              {win.contestTitle}
            </p>
            <p className="text-sm text-zinc-400">
              {win.prizeDescription}
              {win.prizeValue > 0 && (
                <span className="ml-1 font-semibold text-amber-400">
                  (${win.prizeValue.toLocaleString()})
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500">
            <ExternalLink className="h-4 w-4" />
            Claim Prize
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
