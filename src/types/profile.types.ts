import { z } from "zod";

// ---------------------------------------------------------------------------
// Core interfaces
// ---------------------------------------------------------------------------

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface SocialAccounts {
  twitter?: string;
  instagram?: string;
  facebook?: string;
  youtube?: string;
  tiktok?: string;
  pinterest?: string;
  linkedin?: string;
  [platform: string]: string | undefined;
}

export interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  emailAliases: string[];
  phone: string | null;
  phoneProvider: string | null;
  address: Address | null;
  dateOfBirth: string | null;
  gender: string | null;
  socialAccounts: SocialAccounts;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface ProfileCreateInput {
  firstName: string;
  lastName: string;
  email: string;
  emailAliases?: string[];
  phone?: string;
  phoneProvider?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  dateOfBirth?: string;
  gender?: string;
  socialAccounts?: SocialAccounts;
}

export interface ProfileUpdateInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  emailAliases?: string[];
  phone?: string;
  phoneProvider?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  dateOfBirth?: string;
  gender?: string;
  socialAccounts?: SocialAccounts;
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Zod schemas for runtime validation
// ---------------------------------------------------------------------------

export const addressSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  zip: z.string().min(1).max(20),
  country: z.string().length(2).default("US"),
});

export const socialAccountsSchema = z.record(
  z.string(),
  z.string().optional(),
);

export const profileCreateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(254),
  emailAliases: z.array(z.string().email()).max(10).optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/, "Invalid E.164 phone number")
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
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .optional(),
  gender: z.string().max(20).optional(),
  socialAccounts: socialAccountsSchema.optional(),
});

export const profileUpdateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().max(254).optional(),
  emailAliases: z.array(z.string().email()).max(10).optional(),
  phone: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/, "Invalid E.164 phone number")
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
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
    .optional(),
  gender: z.string().max(20).optional(),
  socialAccounts: socialAccountsSchema.optional(),
  isActive: z.boolean().optional(),
});
