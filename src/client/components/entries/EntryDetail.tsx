import { clsx } from 'clsx';
import {
  X,
  ExternalLink,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
} from 'lucide-react';
import { StatusBadge } from '../shared/StatusBadge';
import type { EntryWithContest } from '@/types/entry.types';

interface EntryDetailProps {
  entry: EntryWithContest;
  onClose: () => void;
  onRetry: (entryId: string) => void;
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between py-2">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-sm text-zinc-200">{value ?? '-'}</span>
    </div>
  );
}

function TimelineStep({
  label,
  completed,
  failed,
  time,
}: {
  label: string;
  completed: boolean;
  failed?: boolean;
  time?: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      {failed ? (
        <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
      ) : completed ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <div className="h-4 w-4 shrink-0 rounded-full border-2 border-zinc-600" />
      )}
      <div className="flex flex-1 items-center justify-between">
        <span className={clsx('text-sm', completed ? 'text-zinc-200' : 'text-zinc-500')}>
          {label}
        </span>
        {time && <span className="text-xs text-zinc-600">{new Date(time).toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}

export function EntryDetail({ entry, onClose, onRetry }: EntryDetailProps) {
  const isFailed = entry.status === 'failed';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 h-full w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/95 px-5 py-4 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold text-zinc-100">Entry Detail</h3>
            <StatusBadge status={entry.status} size="md" />
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-5">
          {/* Contest info */}
          <div className="card p-4">
            <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Contest</h4>
            <p className="mt-1 text-sm font-medium text-zinc-200">{entry.contest?.title ?? 'Unknown'}</p>
            {entry.contest?.url && (
              <a
                href={entry.contest.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
              >
                View contest <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Details */}
          <div className="card p-4">
            <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Details</h4>
            <div className="mt-2 divide-y divide-zinc-800/50">
              <DetailRow label="Entry ID" value={entry.id} />
              <DetailRow label="Profile" value={entry.profileId} />
              <DetailRow label="Method" value={entry.entryMethod} />
              <DetailRow label="Attempt" value={String(entry.attemptNumber)} />
              <DetailRow label="Proxy" value={entry.proxyUsed} />
              <DetailRow
                label="Duration"
                value={entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : null}
              />
              <DetailRow
                label="CAPTCHA Cost"
                value={entry.captchaCost ? `$${entry.captchaCost.toFixed(4)}` : null}
              />
            </div>
          </div>

          {/* Timeline */}
          <div className="card p-4">
            <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Timeline</h4>
            <div className="mt-3 space-y-3">
              <TimelineStep
                label="Created"
                completed={true}
                time={entry.createdAt}
              />
              <TimelineStep
                label="CAPTCHA solved"
                completed={entry.captchaSolved}
              />
              <TimelineStep
                label="Form submitted"
                completed={entry.status !== 'pending'}
                failed={isFailed}
                time={entry.submittedAt}
              />
              <TimelineStep
                label="Email confirmed"
                completed={entry.emailConfirmed}
              />
              <TimelineStep
                label="SMS verified"
                completed={entry.smsVerified}
              />
              <TimelineStep
                label="Confirmed"
                completed={entry.status === 'confirmed' || entry.status === 'won'}
                time={entry.confirmedAt}
              />
            </div>
          </div>

          {/* Error */}
          {entry.errorMessage && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4">
              <h4 className="text-xs font-medium text-rose-400">Error Message</h4>
              <p className="mt-1 text-sm text-zinc-300">{entry.errorMessage}</p>
            </div>
          )}

          {/* Screenshots */}
          <div className="card p-4">
            <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Screenshots</h4>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {entry.screenshotPath ? (
                <div className="flex aspect-video items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800">
                  <ImageIcon className="h-6 w-6 text-zinc-600" />
                </div>
              ) : (
                <p className="col-span-2 text-xs text-zinc-600">No screenshots available</p>
              )}
              {entry.errorScreenshot && (
                <div className="flex aspect-video items-center justify-center rounded-lg border border-rose-500/20 bg-zinc-800">
                  <ImageIcon className="h-6 w-6 text-rose-400/50" />
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            {isFailed && (
              <button
                onClick={() => onRetry(entry.id)}
                className="btn-primary flex-1"
              >
                <RotateCcw className="h-4 w-4" />
                Retry Entry
              </button>
            )}
            <button onClick={onClose} className="btn-secondary flex-1">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
