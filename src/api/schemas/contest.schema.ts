import { z } from 'zod';
import { paginationSchema, sortSchema } from './common.schema.js';

// ---------------------------------------------------------------------------
// Contest Zod schemas for API boundary validation
// ---------------------------------------------------------------------------

const isoDateString = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/, 'Expected ISO-8601 date format')
  .refine((s) => !isNaN(new Date(s).getTime()), 'Invalid date value');

export const createContestSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(500).optional(),
  type: z
    .enum(['sweepstakes', 'raffle', 'giveaway', 'instant_win', 'contest', 'daily'])
    .optional()
    .default('sweepstakes'),
  entryMethod: z
    .enum(['form', 'social', 'email', 'purchase', 'multi'])
    .optional()
    .default('form'),
  sponsor: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  source: z.string().max(100).optional(),
  sourceUrl: z.string().url().optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  entryFrequency: z.enum(['once', 'daily', 'weekly', 'unlimited']).optional(),
  maxEntries: z.number().int().positive().optional(),
  prizeDescription: z.string().max(2000).optional(),
  prizeValue: z.number().nonnegative().optional(),
  prizeCategory: z.string().max(100).optional(),
  ageRequirement: z.number().int().min(0).max(100).optional(),
  geoRestrictions: z.record(z.string(), z.unknown()).optional(),
  requiresCaptcha: z.boolean().optional(),
  requiresEmailConfirm: z.boolean().optional(),
  requiresSmsVerify: z.boolean().optional(),
  requiresSocialAction: z.boolean().optional(),
  socialActions: z.array(z.record(z.string(), z.unknown())).optional(),
  termsUrl: z.string().url().optional(),
  formMapping: z.record(z.string(), z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateContestInput = z.infer<typeof createContestSchema>;

export const updateContestSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  sponsor: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  status: z
    .enum(['discovered', 'queued', 'active', 'completed', 'expired', 'invalid', 'blocked'])
    .optional(),
  type: z
    .enum(['sweepstakes', 'raffle', 'giveaway', 'instant_win', 'contest', 'daily'])
    .optional(),
  entryMethod: z.enum(['form', 'social', 'email', 'purchase', 'multi']).optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional(),
  entryFrequency: z.enum(['once', 'daily', 'weekly', 'unlimited']).optional(),
  maxEntries: z.number().int().positive().optional(),
  prizeDescription: z.string().max(2000).optional(),
  prizeValue: z.number().nonnegative().optional(),
  prizeCategory: z.string().max(100).optional(),
  difficultyScore: z.number().min(0).max(1).optional(),
  legitimacyScore: z.number().min(0).max(1).optional(),
  priorityScore: z.number().min(0).max(1).optional(),
  formMapping: z.record(z.string(), z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateContestInput = z.infer<typeof updateContestSchema>;

export const contestFilterSchema = paginationSchema.merge(sortSchema).extend({
  status: z
    .union([
      z.enum(['discovered', 'queued', 'active', 'completed', 'expired', 'invalid', 'blocked']),
      z.string().transform((val) => val.split(',')),
    ])
    .optional(),
  type: z
    .union([
      z.enum(['sweepstakes', 'raffle', 'giveaway', 'instant_win', 'contest', 'daily']),
      z.string().transform((val) => val.split(',')),
    ])
    .optional(),
  source: z.string().optional(),
  search: z.string().max(200).optional(),
  minPriority: z.coerce.number().min(0).max(1).optional(),
  sortBy: z.enum(['priority_score', 'end_date', 'created_at']).optional(),
});

export type ContestFilterInput = z.infer<typeof contestFilterSchema>;

export const bulkEnterSchema = z.object({
  contestIds: z.array(z.string().min(1)).min(1).max(100),
  profileId: z.string().min(1),
});

export type BulkEnterInput = z.infer<typeof bulkEnterSchema>;

export const discoverUrlSchema = z.object({
  url: z.string().url(),
});

export type DiscoverUrlInput = z.infer<typeof discoverUrlSchema>;

export const enterContestSchema = z.object({
  profileId: z.string().min(1),
});

export type EnterContestInput = z.infer<typeof enterContestSchema>;
