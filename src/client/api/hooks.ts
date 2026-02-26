import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { apiClient } from './client';
import type { Contest, ContestFilter, ContestCreateInput, ContestUpdateInput, ContestWithStats } from '@/types/contest.types';
import type { Entry, EntryFilter, EntryStats, EntryWithContest } from '@/types/entry.types';
import type { Profile, ProfileCreateInput, ProfileUpdateInput } from '@/types/profile.types';
import type { QueueMetrics } from '@/types/queue.types';

// ---------------------------------------------------------------------------
// Response wrappers
// ---------------------------------------------------------------------------

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

interface DashboardStats {
  entriesToday: number;
  entriesYesterday: number;
  successRate: number;
  activeContests: number;
  totalWins: number;
  totalPrizeValue: number;
  recentWin: {
    contestTitle: string;
    prizeDescription: string;
    prizeValue: number;
    wonAt: string;
    entryId: string;
  } | null;
}

interface AnalyticsOverview {
  totalEntries: number;
  successRate: number;
  totalCost: number;
  totalWins: number;
  totalPrizeValue: number;
  roi: number;
  costBreakdown: {
    captcha: number;
    proxy: number;
    sms: number;
    email: number;
    other: number;
  };
  topSources: Array<{
    source: string;
    entries: number;
    wins: number;
    successRate: number;
  }>;
}

interface EntryTimeSeriesPoint {
  date: string;
  successful: number;
  failed: number;
  total: number;
}

interface WinHistoryPoint {
  date: string;
  wins: number;
  prizeValue: number;
}

interface SuccessRatePoint {
  date: string;
  rate: number;
}

interface SettingsData {
  general: {
    maxEntriesPerHour: number;
    maxEntriesPerDay: number;
    browserHeadless: boolean;
    maxBrowserInstances: number;
    screenshotOnSuccess: boolean;
    screenshotOnFailure: boolean;
  };
  captcha: {
    provider: string;
    apiKey: string;
    maxTimeoutMs: number;
    maxRetries: number;
    balance?: number;
  };
  proxy: {
    enabled: boolean;
    rotationIntervalMs: number;
    healthCheckIntervalMs: number;
    maxConsecutiveFailures: number;
  };
  schedule: {
    discoveryIntervalMs: number;
    discoveryEnabled: boolean;
    entryScheduleEnabled: boolean;
    entryCronExpression: string;
    healthCheckIntervalMs: number;
  };
  notifications: {
    emailOnWin: boolean;
    emailOnError: boolean;
    emailRecipient: string;
  };
}

interface DiscoverySource {
  id: string;
  name: string;
  type: string;
  url: string;
  enabled: boolean;
  lastRun: string | null;
  contestsFound: number;
}

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const queryKeys = {
  contests: {
    all: ['contests'] as const,
    list: (filters?: ContestFilter) => ['contests', 'list', filters] as const,
    detail: (id: string) => ['contests', 'detail', id] as const,
  },
  entries: {
    all: ['entries'] as const,
    list: (filters?: EntryFilter) => ['entries', 'list', filters] as const,
    detail: (id: string) => ['entries', 'detail', id] as const,
    stats: (filters?: Partial<EntryFilter>) => ['entries', 'stats', filters] as const,
  },
  profiles: {
    all: ['profiles'] as const,
    list: () => ['profiles', 'list'] as const,
    detail: (id: string) => ['profiles', 'detail', id] as const,
  },
  queue: {
    all: ['queue'] as const,
    status: () => ['queue', 'status'] as const,
    jobs: (queue?: string, status?: string) => ['queue', 'jobs', queue, status] as const,
  },
  dashboard: {
    stats: () => ['dashboard', 'stats'] as const,
  },
  analytics: {
    overview: (dateRange?: { from: string; to: string }) => ['analytics', 'overview', dateRange] as const,
    timeSeries: (dateRange?: { from: string; to: string }) => ['analytics', 'timeSeries', dateRange] as const,
    successRate: (dateRange?: { from: string; to: string }) => ['analytics', 'successRate', dateRange] as const,
    winHistory: (dateRange?: { from: string; to: string }) => ['analytics', 'winHistory', dateRange] as const,
  },
  settings: {
    all: ['settings'] as const,
  },
  discovery: {
    sources: () => ['discovery', 'sources'] as const,
  },
};

// ---------------------------------------------------------------------------
// Contest hooks
// ---------------------------------------------------------------------------

export function useContests(filters?: ContestFilter) {
  return useQuery({
    queryKey: queryKeys.contests.list(filters),
    queryFn: ({ signal }) =>
      apiClient.get<PaginatedResponse<ContestWithStats>>('/contests', filters as Record<string, string | number | boolean | undefined>, signal),
    staleTime: 60_000,
  });
}

export function useContest(id: string, options?: Partial<UseQueryOptions<Contest>>) {
  return useQuery({
    queryKey: queryKeys.contests.detail(id),
    queryFn: ({ signal }) => apiClient.get<Contest>(`/contests/${id}`, undefined, signal),
    enabled: !!id,
    ...options,
  });
}

export function useCreateContest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ContestCreateInput) =>
      apiClient.post<Contest>('/contests', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contests.all });
    },
  });
}

export function useUpdateContest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ContestUpdateInput & { id: string }) =>
      apiClient.patch<Contest>(`/contests/${id}`, input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contests.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contests.detail(variables.id) });
    },
  });
}

export function useEnterContest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contestId, profileId }: { contestId: string; profileId: string }) =>
      apiClient.post<Entry>(`/contests/${contestId}/enter`, { profileId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.entries.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats() });
    },
  });
}

// ---------------------------------------------------------------------------
// Entry hooks
// ---------------------------------------------------------------------------

export function useEntries(filters?: EntryFilter) {
  return useQuery({
    queryKey: queryKeys.entries.list(filters),
    queryFn: ({ signal }) =>
      apiClient.get<PaginatedResponse<EntryWithContest>>('/entries', filters as Record<string, string | number | boolean | undefined>, signal),
    staleTime: 30_000,
  });
}

export function useEntry(id: string) {
  return useQuery({
    queryKey: queryKeys.entries.detail(id),
    queryFn: ({ signal }) => apiClient.get<EntryWithContest>(`/entries/${id}`, undefined, signal),
    enabled: !!id,
  });
}

export function useRetryEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      apiClient.post<Entry>(`/entries/${entryId}/retry`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.entries.all });
    },
  });
}

export function useEntryStats(filters?: Partial<EntryFilter>) {
  return useQuery({
    queryKey: queryKeys.entries.stats(filters),
    queryFn: ({ signal }) =>
      apiClient.get<EntryStats>('/entries/stats', filters as Record<string, string | number | boolean | undefined>, signal),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Profile hooks
// ---------------------------------------------------------------------------

export function useProfiles() {
  return useQuery({
    queryKey: queryKeys.profiles.list(),
    queryFn: ({ signal }) => apiClient.get<Profile[]>('/profiles', undefined, signal),
    staleTime: 120_000,
  });
}

export function useProfile(id: string) {
  return useQuery({
    queryKey: queryKeys.profiles.detail(id),
    queryFn: ({ signal }) => apiClient.get<Profile>(`/profiles/${id}`, undefined, signal),
    enabled: !!id,
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileCreateInput) =>
      apiClient.post<Profile>('/profiles', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ProfileUpdateInput & { id: string }) =>
      apiClient.patch<Profile>(`/profiles/${id}`, input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.detail(variables.id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Queue hooks
// ---------------------------------------------------------------------------

export function useQueueStatus() {
  return useQuery({
    queryKey: queryKeys.queue.status(),
    queryFn: ({ signal }) => apiClient.get<QueueMetrics>('/queue/status', undefined, signal),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function usePauseQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (queueName: string) =>
      apiClient.post(`/queue/${queueName}/pause`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.queue.all });
    },
  });
}

export function useResumeQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (queueName: string) =>
      apiClient.post(`/queue/${queueName}/resume`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.queue.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Dashboard hooks
// ---------------------------------------------------------------------------

export function useDashboardStats() {
  return useQuery({
    queryKey: queryKeys.dashboard.stats(),
    queryFn: ({ signal }) => apiClient.get<DashboardStats>('/dashboard/stats', undefined, signal),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Analytics hooks
// ---------------------------------------------------------------------------

export function useAnalyticsOverview(dateRange?: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.analytics.overview(dateRange),
    queryFn: ({ signal }) =>
      apiClient.get<AnalyticsOverview>('/analytics/overview', dateRange as Record<string, string>, signal),
    staleTime: 120_000,
  });
}

export function useEntryTimeSeries(dateRange?: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.analytics.timeSeries(dateRange),
    queryFn: ({ signal }) =>
      apiClient.get<EntryTimeSeriesPoint[]>('/analytics/entries/timeseries', dateRange as Record<string, string>, signal),
    staleTime: 120_000,
  });
}

export function useSuccessRateTimeSeries(dateRange?: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.analytics.successRate(dateRange),
    queryFn: ({ signal }) =>
      apiClient.get<SuccessRatePoint[]>('/analytics/success-rate', dateRange as Record<string, string>, signal),
    staleTime: 120_000,
  });
}

export function useWinHistory(dateRange?: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.analytics.winHistory(dateRange),
    queryFn: ({ signal }) =>
      apiClient.get<WinHistoryPoint[]>('/analytics/wins', dateRange as Record<string, string>, signal),
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Settings hooks
// ---------------------------------------------------------------------------

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: ({ signal }) => apiClient.get<SettingsData>('/settings', undefined, signal),
    staleTime: 300_000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<SettingsData>) =>
      apiClient.patch<SettingsData>('/settings', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Discovery hooks
// ---------------------------------------------------------------------------

export function useDiscoverySources() {
  return useQuery({
    queryKey: queryKeys.discovery.sources(),
    queryFn: ({ signal }) => apiClient.get<DiscoverySource[]>('/discovery/sources', undefined, signal),
    staleTime: 120_000,
  });
}

export function useTriggerDiscovery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId?: string) =>
      apiClient.post('/discovery/run', sourceId ? { sourceId } : undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.discovery.sources() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.queue.all });
    },
  });
}

// Re-export types for convenience
export type {
  DashboardStats,
  AnalyticsOverview,
  EntryTimeSeriesPoint,
  WinHistoryPoint,
  SuccessRatePoint,
  SettingsData,
  DiscoverySource,
  PaginatedResponse,
};
