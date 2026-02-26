import { z } from 'zod';

// ---------------------------------------------------------------------------
// Profile Zod schemas for API boundary validation
// ---------------------------------------------------------------------------

export const createProfileSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(254),
  emailAliases: z.array(z.string().email()).max(10).optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid E.164 phone number')
    .optional(),
  phoneProvider: z.string().max(50).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zip: z.string().max(20).optional(),
  country: z.string().length(2).optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD format')
    .refine((s) => {
      const d = new Date(s + 'T00:00:00Z');
      return !isNaN(d.getTime()) && d.toISOString().startsWith(s);
    }, 'Invalid calendar date')
    .optional(),
  gender: z.string().max(20).optional(),
  socialAccounts: z.record(z.string(), z.string().optional()).optional(),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = createProfileSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
