import { useState } from 'react';
import { clsx } from 'clsx';
import { LayoutGrid, List } from 'lucide-react';
import { ContestCard } from './ContestCard';
import { EmptyState } from '../shared/EmptyState';
import { LoadingSpinner } from '../shared/LoadingSpinner';
import type { ContestWithStats } from '@/types/contest.types';

interface ContestListProps {
  contests: ContestWithStats[];
  loading?: boolean;
  onEnter: (contestId: string) => void;
  onViewDetails: (contestId: string) => void;
}

export function ContestList({ contests, loading, onEnter, onViewDetails }: ContestListProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner message="Loading contests..." />
      </div>
    );
  }

  if (contests.length === 0) {
    return (
      <EmptyState
        title="No contests found"
        message="Try adjusting your filters or run discovery to find new contests."
      />
    );
  }

  return (
    <div>
      {/* View toggle */}
      <div className="mb-4 flex justify-end">
        <div className="flex rounded-lg border border-zinc-700 bg-zinc-800/50">
          <button
            onClick={() => setViewMode('grid')}
            className={clsx(
              'rounded-l-lg p-2 transition-colors',
              viewMode === 'grid' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={clsx(
              'rounded-r-lg p-2 transition-colors',
              viewMode === 'list' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {contests.map((contest) => (
            <ContestCard
              key={contest.id}
              contest={contest}
              onEnter={onEnter}
              onViewDetails={onViewDetails}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {contests.map((contest) => (
            <ContestCard
              key={contest.id}
              contest={contest}
              onEnter={onEnter}
              onViewDetails={onViewDetails}
            />
          ))}
        </div>
      )}
    </div>
  );
}
