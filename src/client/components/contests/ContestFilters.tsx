import { Search, X } from 'lucide-react';
import type { ContestFilter } from '@/types/contest.types';

interface ContestFiltersProps {
  filters: ContestFilter;
  onFiltersChange: (filters: ContestFilter) => void;
  sources: string[];
}

export function ContestFilters({ filters, onFiltersChange, sources }: ContestFiltersProps) {
  const updateFilter = <K extends keyof ContestFilter>(key: K, value: ContestFilter[K]) => {
    onFiltersChange({ ...filters, [key]: value, offset: 0 });
  };

  const clearFilters = () => {
    onFiltersChange({ limit: filters.limit, offset: 0 });
  };

  const hasActiveFilters = !!(filters.search || filters.status || filters.type);

  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          placeholder="Search contests..."
          value={filters.search ?? ''}
          onChange={(e) => updateFilter('search', e.target.value || undefined)}
          className="input-field pl-9"
        />
      </div>

      {/* Status */}
      <select
        value={(filters.status as string) ?? ''}
        onChange={(e) => updateFilter('status', (e.target.value || undefined) as ContestFilter['status'])}
        className="select-field w-40"
      >
        <option value="">All Statuses</option>
        <option value="discovered">Discovered</option>
        <option value="queued">Queued</option>
        <option value="active">Active</option>
        <option value="completed">Completed</option>
        <option value="expired">Expired</option>
        <option value="blocked">Blocked</option>
      </select>

      {/* Type */}
      <select
        value={(filters.type as string) ?? ''}
        onChange={(e) => updateFilter('type', (e.target.value || undefined) as ContestFilter['type'])}
        className="select-field w-40"
      >
        <option value="">All Types</option>
        <option value="sweepstakes">Sweepstakes</option>
        <option value="raffle">Raffle</option>
        <option value="giveaway">Giveaway</option>
        <option value="instant_win">Instant Win</option>
        <option value="contest">Contest</option>
        <option value="daily">Daily</option>
      </select>

      {/* Source */}
      {sources.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) {
              onFiltersChange({ ...filters, search: e.target.value, offset: 0 });
            }
          }}
          className="select-field w-40"
        >
          <option value="">All Sources</option>
          {sources.map((src) => (
            <option key={src} value={src}>
              {src}
            </option>
          ))}
        </select>
      )}

      {/* Sort */}
      <select
        value={filters.orderBy ?? 'priority_score'}
        onChange={(e) => updateFilter('orderBy', e.target.value as ContestFilter['orderBy'])}
        className="select-field w-40"
      >
        <option value="priority_score">Priority</option>
        <option value="end_date">End Date</option>
        <option value="created_at">Newest</option>
        <option value="prize_value">Prize Value</option>
      </select>

      {/* Clear */}
      {hasActiveFilters && (
        <button onClick={clearFilters} className="btn-ghost text-xs text-zinc-500">
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
