import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { apiClient } from './client';
import type { Contest, ContestFilter, ContestCreateInput, ContestUpdateInput, ContestWithStats } from '@/types/contest.types';
import type { Entry, EntryFilter, EntryWithContest } from '@/types/entry.types';
import type { Profile, ProfileCreateInput, ProfileUpdateInput } from '@/types/profile.types';
import type { QueueStatus } from '@/types/queue.types';

// ---------------------------------------------------------------------------
// Response wrappers - these match what the backend actually sends
// ---------------------------------------------------------------------------

/** Backend wraps most responses in { data: ... } */
interface DataEnvelope<T> {
  data: T;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Backend paginated response uses page-based pagination */
interface ServerPaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
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

interface EntryStats {
  total: number;
  pending: number;
  submitted: number;
  confirmed: number;
  failed: number;
  won: number;
  lost: number;
  expired: number;
  duplicate: number;
  avgDurationMs: number | null;
  totalCaptchaCost: number;
  successRate: number;
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

interface QueueMetrics {
  queues: QueueStatus[];
  totalJobs: number;
  totalCompleted: number;
  totalFailed: number;
  avgProcessingTimeMs: number;
  jobsPerMinute: number;
  oldestWaitingJob: string | null;
  uptimeMs: number;
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
    queryFn: async ({ signal }) => {
      // Backend uses page-based pagination; convert offset to page
      const page = filters?.offset != null && filters?.limit
        ? Math.floor(filters.offset / filters.limit) + 1
        : 1;
      const params: Record<string, string | number | boolean | undefined> = {
        page,
        limit: filters?.limit ?? 20,
        status: filters?.status as string | undefined,
        type: filters?.type as string | undefined,
        search: filters?.search,
        sortBy: filters?.orderBy,
        sortOrder: filters?.orderDirection,
      };
      const resp = await apiClient.get<ServerPaginatedResponse<ContestWithStats>>('/contests', params, signal);
      // Normalize to client PaginatedResponse shape
      return {
        data: resp.data ?? [],
        total: resp.pagination?.total ?? 0,
        limit: resp.pagination?.limit ?? (filters?.limit ?? 20),
        offset: filters?.offset ?? 0,
      } as PaginatedResponse<ContestWithStats>;
    },
    staleTime: 60_000,
  });
}

export function useContest(id: string, options?: Partial<UseQueryOptions<Contest>>) {
  return useQuery({
    queryKey: queryKeys.contests.detail(id),
    queryFn: async ({ signal }) => {
      const resp = await apiClient.get<DataEnvelope<Contest>>(`/contests/${id}`, undefined, signal);
      return resp.data;
    },
    enabled: !!id,
    ...options,
  });
}

export function useCreateContest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ContestCreateInput) =>
      apiClient.post<DataEnvelope<Contest>>('/contests', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.contests.all });
    },
  });
}

export function useUpdateContest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ContestUpdateInput & { id: string }) =>
      apiClient.patch<DataEnvelope<Contest>>(`/contests/${id}`, input),
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
      apiClient.post<DataEnvelope<Entry>>(`/contests/${contestId}/enter`, { profileId }),
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
    queryFn: async ({ signal }) => {
      // Backend uses page-based pagination; convert offset to page
      const page = filters?.offset != null && filters?.limit
        ? Math.floor(filters.offset / filters.limit) + 1
        : 1;
      const params: Record<string, string | number | boolean | undefined> = {
        page,
        limit: filters?.limit ?? 25,
        status: filters?.status as string | undefined,
        contestId: filters?.contestId,
        profileId: filters?.profileId,
      };
      const resp = await apiClient.get<ServerPaginatedResponse<EntryWithContest>>('/entries', params, signal);
      return {
        data: resp.data ?? [],
        total: resp.pagination?.total ?? 0,
        limit: resp.pagination?.limit ?? (filters?.limit ?? 25),
        offset: filters?.offset ?? 0,
      } as PaginatedResponse<EntryWithContest>;
    },
    staleTime: 30_000,
  });
}

export function useEntry(id: string) {
  return useQuery({
    queryKey: queryKeys.entries.detail(id),
    queryFn: async ({ signal }) => {
      const resp = await apiClient.get<DataEnvelope<EntryWithContest>>(`/entries/${id}`, undefined, signal);
      return resp.data;
    },
    enabled: !!id,
  });
}

export function useRetryEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      apiClient.post<unknown>(`/entries/${entryId}/retry`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.entries.all });
    },
  });
}

export function useEntryStats(filters?: Partial<EntryFilter>) {
  return useQuery({
    queryKey: queryKeys.entries.stats(filters),
    queryFn: async ({ signal }) => {
      // Backend returns { data: { total, byStatus: {...}, successRate, avgDurationMs, totalCaptchaCost } }
      const resp = await apiClient.get<DataEnvelope<{
        total: number;
        byStatus: Record<string, number>;
        successRate: number;
        avgDurationMs: number | null;
        totalCaptchaCost: number;
      }>>('/entries/stats', filters as Record<string, string | number | boolean | undefined>, signal);
      const raw = resp.data;
      // Normalize successRate: backend sends as percentage (e.g., 85.2), convert to fraction
      const successRate = (raw?.successRate ?? 0) / 100;
      return {
        total: raw?.total ?? 0,
        pending: raw?.byStatus?.pending ?? 0,
        submitted: raw?.byStatus?.submitted ?? 0,
        confirmed: raw?.byStatus?.confirmed ?? 0,
        failed: raw?.byStatus?.failed ?? 0,
        won: raw?.byStatus?.won ?? 0,
        lost: raw?.byStatus?.lost ?? 0,
        expired: raw?.byStatus?.expired ?? 0,
        duplicate: raw?.byStatus?.duplicate ?? 0,
        avgDurationMs: raw?.avgDurationMs ?? null,
        totalCaptchaCost: raw?.totalCaptchaCost ?? 0,
        successRate,
      } as EntryStats;
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Profile hooks
// ---------------------------------------------------------------------------

export function useProfiles() {
  return useQuery({
    queryKey: queryKeys.profiles.list(),
    queryFn: async ({ signal }) => {
      // Backend returns { data: profileRows[] }
      const resp = await apiClient.get<DataEnvelope<Profile[]>>('/profiles', undefined, signal);
      return resp.data ?? [];
    },
    staleTime: 120_000,
  });
}

export function useProfile(id: string) {
  return useQuery({
    queryKey: queryKeys.profiles.detail(id),
    queryFn: async ({ signal }) => {
      const resp = await apiClient.get<DataEnvelope<Profile>>(`/profiles/${id}`, undefined, signal);
      return resp.data;
    },
    enabled: !!id,
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileCreateInput) =>
      apiClient.post<DataEnvelope<Profile>>('/profiles', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ProfileUpdateInput & { id: string }) =>
      apiClient.patch<DataEnvelope<Profile>>(`/profiles/${id}`, input),
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
    queryFn: async ({ signal }) => {
      // Backend returns { data: { [queueName]: { status, waiting, active, completed, failed, delayed } } }
      const resp = await apiClient.get<DataEnvelope<Record<string, {
        status: string;
        waiting?: number;
        active?: number;
        completed?: number;
        failed?: number;
        delayed?: number;
      }>>>('/queue/status', undefined, signal);
      const raw = resp.data ?? {};
      // Transform the dict into an array matching QueueMetrics shape
      const queues: QueueStatus[] = Object.entries(raw).map(([name, q]) => ({
        name: name as QueueStatus['name'],
        waiting: q?.waiting ?? 0,
        active: q?.active ?? 0,
        completed: q?.completed ?? 0,
        failed: q?.failed ?? 0,
        delayed: q?.delayed ?? 0,
        paused: q?.status === 'paused',
      }));
      const totalJobs = queues.reduce((sum, q) => sum + q.waiting + q.active, 0);
      const totalCompleted = queues.reduce((sum, q) => sum + q.completed, 0);
      const totalFailed = queues.reduce((sum, q) => sum + q.failed, 0);
      return {
        queues,
        totalJobs,
        totalCompleted,
        totalFailed,
        avgProcessingTimeMs: 0,
        jobsPerMinute: 0,
        oldestWaitingJob: null,
        uptimeMs: 0,
      } as QueueMetrics;
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function usePauseQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (_queueName: string) =>
      apiClient.post('/queue/pause'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.queue.all });
    },
  });
}

export function useResumeQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (_queueName: string) =>
      apiClient.post('/queue/resume'),
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
    queryFn: async ({ signal }) => {
      // Dashboard endpoint returns flat object (no { data: ... } wrapper)
      const raw = await apiClient.get<DashboardStats>('/dashboard/stats', undefined, signal);
      // successRate from backend is a percentage (e.g., 85.2), convert to fraction for UI
      return {
        ...raw,
        successRate: (raw.successRate ?? 0) / 100,
      };
    },
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
    queryFn: async ({ signal }) => {
      // Backend returns { data: { entriesToday, totalEntries, successRate, ... } }
      const resp = await apiClient.get<DataEnvelope<Record<string, unknown>>>('/analytics/overview', dateRange as Record<string, string>, signal);
      const raw = resp.data ?? {};
      const successRate = Number(raw.successRate ?? 0) / 100;
      return {
        totalEntries: Number(raw.totalEntries ?? 0),
        successRate,
        totalCost: Number(raw.costsToday ?? 0),
        totalWins: Array.isArray(raw.recentWins) ? (raw.recentWins as unknown[]).length : 0,
        totalPrizeValue: 0,
        roi: 0,
        costBreakdown: {
          captcha: 0,
          proxy: 0,
          sms: 0,
          email: 0,
          other: Number(raw.costsToday ?? 0),
        },
        topSources: [],
      } as AnalyticsOverview;
    },
    staleTime: 120_000,
  });
}

export function useEntryTimeSeries(dateRange?: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.analytics.timeSeries(dateRange),
    queryFn: async ({ signal }) => {
      // Backend returns { data: [{ period, total, successful, failed }], meta: {...} }
      const resp = await apiClient.get<{
        data: Array<{ period: string; total: number; successful: number; failed: number }>;
      }>('/analytics/entries', dateRange as Record<string, string>, signal);
      const points = resp.data ?? [];
      return points.map((p) => ({
        date: p.period,
        successful: p.successful ?? 0,
        failed: p.failed ?? 0,
        total: p.total ?? 0,
      })) as EntryTimeSeriesPoint[];
    },
    staleTime: 120_000,
  });
}

export function useSuccessRateTimeSeries(dateRange?: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.analytics.successRate(dateRange),
    queryFn: async ({ signal }) => {
      // Reuse the entry time series endpoint and derive success rate
      const resp = await apiClient.get<{
        data: Array<{ period: string; total: number; successful: number; failed: number }>;
      }>('/analytics/entries', dateRange as Record<string, string>, signal);
      const points = resp.data ?? [];
      return points.map((p) => ({
        date: p.period,
        rate: p.total > 0 ? p.successful / p.total : 0,
      })) as SuccessRatePoint[];
    },
    staleTime: 120_000,
  });
}

export function useWinHistory(dateRange?: { from: string; to: string }) {
  return useQuery({
    queryKey: queryKeys.analytics.winHistory(dateRange),
    queryFn: async ({ signal }) => {
      // Backend returns a paginated response from /analytics/wins
      const resp = await apiClient.get<{
        data: Array<{ createdAt?: string; prizeValue?: number; [key: string]: unknown }>;
      }>('/analytics/wins', dateRange as Record<string, string>, signal);
      const wins = resp.data ?? [];
      // Group wins by month for the chart
      const byMonth = new Map<string, { wins: number; prizeValue: number }>();
      for (const w of wins) {
        const d = w.createdAt ? w.createdAt.substring(0, 7) : 'unknown';
        const existing = byMonth.get(d) ?? { wins: 0, prizeValue: 0 };
        existing.wins += 1;
        existing.prizeValue += Number(w.prizeValue ?? 0);
        byMonth.set(d, existing);
      }
      return Array.from(byMonth.entries()).map(([date, v]) => ({
        date,
        wins: v.wins,
        prizeValue: v.prizeValue,
      })) as WinHistoryPoint[];
    },
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Settings hooks
// ---------------------------------------------------------------------------

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings.all,
    queryFn: async ({ signal }) => {
      // Backend returns { data: { general: {...}, captcha: {...}, ... } }
      const resp = await apiClient.get<DataEnvelope<SettingsData>>('/settings', undefined, signal);
      return resp.data;
    },
    staleTime: 300_000,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<SettingsData>) =>
      apiClient.put<DataEnvelope<SettingsData>>('/settings', input),
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
    queryFn: async ({ signal }) => {
      // Backend returns { data: sources[] }
      const resp = await apiClient.get<DataEnvelope<DiscoverySource[]>>('/discovery/sources', undefined, signal);
      return resp.data ?? [];
    },
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

// ---------------------------------------------------------------------------
// Proxy hooks
// ---------------------------------------------------------------------------

interface ProxyEntry {
  id: string;
  host: string;
  port: number;
  protocol: string;
  healthStatus: string;
  isActive: number;
  username: string | null;
  password: string | null;
  type: string | null;
  country: string | null;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number | null;
  lastHealthCheck: string | null;
  createdAt: string;
}

export function useProxies() {
  return useQuery({
    queryKey: ['proxies', 'list'] as const,
    queryFn: async ({ signal }) => {
      const resp = await apiClient.get<DataEnvelope<ProxyEntry[]>>('/proxy', undefined, signal);
      return resp.data ?? [];
    },
    staleTime: 60_000,
  });
}

export function useCreateProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { host: string; port: number; protocol: string }) =>
      apiClient.post<DataEnvelope<ProxyEntry>>('/proxy', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['proxies'] });
    },
  });
}

export function useDeleteProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (proxyId: string) =>
      apiClient.delete(`/proxy/${proxyId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['proxies'] });
    },
  });
}

export function useProxyHealthCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post('/proxy/health-check'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['proxies'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Email account hooks
// ---------------------------------------------------------------------------

interface EmailAccount {
  id: string;
  profileId: string;
  emailAddress: string;
  provider: string;
  isActive: number;
  lastSyncAt: string | null;
  createdAt: string;
}

export function useEmailAccounts() {
  return useQuery({
    queryKey: ['email', 'accounts'] as const,
    queryFn: async ({ signal }) => {
      const resp = await apiClient.get<DataEnvelope<EmailAccount[]>>('/email/accounts', undefined, signal);
      return resp.data ?? [];
    },
    staleTime: 120_000,
  });
}

export function useConnectEmailAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId?: string) =>
      apiClient.post<DataEnvelope<{ authUrl: string; message: string }>>('/email/accounts/connect', profileId ? { profileId } : undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email'] });
    },
  });
}

export function useDisconnectEmailAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      apiClient.delete(`/email/accounts/${accountId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email'] });
    },
  });
}

export function useSyncEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post('/email/sync'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Captcha test hook
// ---------------------------------------------------------------------------

export function useTestCaptcha() {
  return useMutation({
    mutationFn: () =>
      apiClient.post<DataEnvelope<{ status: string; message: string }>>('/settings/test-captcha'),
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
  EntryStats,
  QueueMetrics,
  ProxyEntry,
  EmailAccount,
};
