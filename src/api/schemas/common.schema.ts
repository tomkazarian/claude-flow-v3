import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared Zod schemas for request validation across all API routes
// ---------------------------------------------------------------------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

const isoDateString = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/, 'Expected ISO-8601 date format')
  .refine((s) => !isNaN(new Date(s).getTime()), 'Invalid date value');

export const dateRangeSchema = z.object({
  from: isoDateString.optional(),
  to: isoDateString.optional(),
});

export type DateRangeInput = z.infer<typeof dateRangeSchema>;

export const idParamSchema = z.object({
  id: z.string().min(1),
});

export type IdParamInput = z.infer<typeof idParamSchema>;

export const sortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type SortInput = z.infer<typeof sortSchema>;

/**
 * Builds a standard paginated response envelope.
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
} {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
