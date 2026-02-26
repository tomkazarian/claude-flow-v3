import { clsx } from 'clsx';
import { Clock, Shield, Lock, Mail, Phone, Zap } from 'lucide-react';
import { StatusBadge } from '../shared/StatusBadge';
import type { ContestWithStats } from '@/types/contest.types';

interface ContestCardProps {
  contest: ContestWithStats;
  onEnter: (contestId: string) => void;
  onViewDetails: (contestId: string) => void;
}

const typeColors: Record<string, string> = {
  sweepstakes: 'bg-blue-500/10 text-blue-400',
  raffle: 'bg-purple-500/10 text-purple-400',
  giveaway: 'bg-emerald-500/10 text-emerald-400',
  instant_win: 'bg-amber-500/10 text-amber-400',
  contest: 'bg-sky-500/10 text-sky-400',
  daily: 'bg-violet-500/10 text-violet-400',
};

function getDaysLeft(endDate: string | null): string | null {
  if (!endDate) return null;
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

function DifficultyMeter({ score }: { score: number | null }) {
  const level = score != null ? Math.round(score * 5) : 0;
  return (
    <div className="flex items-center gap-0.5" title={`Difficulty: ${level}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            i < level ? 'bg-amber-400' : 'bg-zinc-700',
          )}
        />
      ))}
    </div>
  );
}

function LegitimacyIndicator({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-zinc-600">N/A</span>;
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? 'text-emerald-400' : pct >= 40 ? 'text-yellow-400' : 'text-rose-400';
  return (
    <div className="flex items-center gap-1" title={`Legitimacy: ${pct}%`}>
      <Shield className={clsx('h-3 w-3', color)} />
      <span className={clsx('text-xs font-medium', color)}>{pct}%</span>
    </div>
  );
}

export function ContestCard({ contest, onEnter, onViewDetails }: ContestCardProps) {
  const daysLeft = getDaysLeft(contest.endDate);
  const isExpired = daysLeft === 'Expired';
  const canEnter = !isExpired && contest.status !== 'completed' && contest.status !== 'blocked' && contest.status !== 'invalid';

  return (
    <div className="card-hover flex flex-col p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 flex-1 text-sm font-medium leading-snug text-zinc-200">
          {contest.title}
        </h3>
        <StatusBadge status={contest.status} />
      </div>

      {/* Type + Prize */}
      <div className="mt-3 flex items-center gap-2">
        <span className={clsx('badge', typeColors[contest.type] ?? 'bg-zinc-500/10 text-zinc-400')}>
          {contest.type.replace('_', ' ')}
        </span>
        {contest.prizeValue != null && contest.prizeValue > 0 && (
          <span className="text-sm font-semibold text-emerald-400">
            ${contest.prizeValue.toLocaleString()}
          </span>
        )}
      </div>

      {/* Prize description */}
      {contest.prizeDescription && (
        <p className="mt-2 line-clamp-1 text-xs text-zinc-500">{contest.prizeDescription}</p>
      )}

      {/* Metadata row */}
      <div className="mt-3 flex items-center gap-4">
        {daysLeft && (
          <div className="flex items-center gap-1">
            <Clock className={clsx('h-3 w-3', isExpired ? 'text-rose-400' : 'text-zinc-500')} />
            <span className={clsx('text-xs', isExpired ? 'text-rose-400' : 'text-zinc-400')}>
              {daysLeft}
            </span>
          </div>
        )}
        <DifficultyMeter score={contest.difficultyScore} />
        <LegitimacyIndicator score={contest.legitimacyScore} />
      </div>

      {/* Requirements icons */}
      <div className="mt-3 flex items-center gap-2">
        {contest.requiresCaptcha && (
          <div className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5" title="Requires CAPTCHA">
            <Lock className="h-3 w-3 text-amber-400" />
            <span className="text-[10px] text-zinc-500">CAPTCHA</span>
          </div>
        )}
        {contest.requiresEmailConfirm && (
          <div className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5" title="Email confirmation required">
            <Mail className="h-3 w-3 text-blue-400" />
            <span className="text-[10px] text-zinc-500">Email</span>
          </div>
        )}
        {contest.requiresSmsVerify && (
          <div className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5" title="SMS verification required">
            <Phone className="h-3 w-3 text-violet-400" />
            <span className="text-[10px] text-zinc-500">SMS</span>
          </div>
        )}
        {contest.entryMethod && (
          <div className="flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5">
            <Zap className="h-3 w-3 text-zinc-500" />
            <span className="text-[10px] text-zinc-500">{contest.entryMethod}</span>
          </div>
        )}
      </div>

      {/* Entry stats */}
      {contest.totalEntries > 0 && (
        <div className="mt-3 flex items-center gap-3 text-xs text-zinc-500">
          <span>{contest.totalEntries} entries</span>
          <span>{contest.successfulEntries} successful</span>
          {contest.hasWin && <span className="font-medium text-amber-400">Won!</span>}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2 border-t border-zinc-800/50 pt-4">
        <button
          onClick={() => onEnter(contest.id)}
          disabled={!canEnter}
          className="btn-primary flex-1 text-xs"
        >
          Enter Now
        </button>
        <button
          onClick={() => onViewDetails(contest.id)}
          className="btn-secondary text-xs"
        >
          Details
        </button>
      </div>
    </div>
  );
}
