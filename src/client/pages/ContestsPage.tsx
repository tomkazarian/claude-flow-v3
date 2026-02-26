import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { useContests, useEnterContest } from '../api/hooks';
import { ContestFilters } from '../components/contests/ContestFilters';
import { ContestList } from '../components/contests/ContestList';
import { Pagination } from '../components/shared/Pagination';
import { toast } from '../stores/notification.store';
import type { ContestFilter } from '@/types/contest.types';

const PAGE_SIZE = 20;

export function ContestsPage() {
  const [filters, setFilters] = useState<ContestFilter>({
    limit: PAGE_SIZE,
    offset: 0,
    orderBy: 'priority_score',
    orderDirection: 'desc',
  });

  const { data, isLoading } = useContests(filters);
  const enterContest = useEnterContest();

  const handleEnter = useCallback(
    (contestId: string) => {
      enterContest.mutate(
        { contestId, profileId: 'default' },
        {
          onSuccess: () => toast.success('Entry queued', 'Contest entry has been queued for processing.'),
          onError: (err) => toast.error('Entry failed', err.message),
        },
      );
    },
    [enterContest],
  );

  const handleViewDetails = useCallback((_contestId: string) => {
    // In a full app this would open a detail panel or navigate
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Contests</h2>
          <p className="text-sm text-zinc-500">
            {data?.total ?? 0} contests found
          </p>
        </div>
        <button className="btn-primary">
          <Plus className="h-4 w-4" />
          Add Contest
        </button>
      </div>

      {/* Filters */}
      <ContestFilters
        filters={filters}
        onFiltersChange={setFilters}
        sources={[]}
      />

      {/* List */}
      <ContestList
        contests={data?.data ?? []}
        loading={isLoading}
        onEnter={handleEnter}
        onViewDetails={handleViewDetails}
      />

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <Pagination
          total={data.total}
          limit={PAGE_SIZE}
          offset={filters.offset ?? 0}
          onPageChange={(offset) => setFilters((f) => ({ ...f, offset }))}
        />
      )}
    </div>
  );
}
