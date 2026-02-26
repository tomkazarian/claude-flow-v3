import { z } from 'zod';
import { paginationSchema, dateRangeSchema } from './common.schema.js';

// ---------------------------------------------------------------------------
// Entry Zod schemas for API boundary validation
// ---------------------------------------------------------------------------

export const entryFilterSchema = paginationSchema.merge(dateRangeSchema).extend({
  status: z
    .union([
      z.enum([
        'pending',
        'submitted',
        'confirmed',
        'failed',
        'won',
        'lost',
        'expired',
        'duplicate',
      ]),
      z.string().transform((val) => val.split(',')),
    ])
    .optional(),
  contestId: z.string().optional(),
  profileId: z.string().optional(),
});

export type EntryFilterInput = z.infer<typeof entryFilterSchema>;

export const retryEntrySchema = z.object({
  profileId: z.string().min(1).optional(),
});

export type RetryEntryInput = z.infer<typeof retryEntrySchema>;

export const exportFormatSchema = z.object({
  format: z.enum(['csv', 'json']).default('json'),
});

export type ExportFormatInput = z.infer<typeof exportFormatSchema>;
