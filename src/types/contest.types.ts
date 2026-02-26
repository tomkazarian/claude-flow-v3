import { z } from "zod";

// ---------------------------------------------------------------------------
// String literal unions
// ---------------------------------------------------------------------------

export type ContestType =
  | "sweepstakes"
  | "raffle"
  | "giveaway"
  | "instant_win"
  | "contest"
  | "daily";

export type ContestStatus =
  | "discovered"
  | "queued"
  | "active"
  | "completed"
  | "expired"
  | "invalid"
  | "blocked";

export type EntryMethod =
  | "form"
  | "social"
  | "email"
  | "purchase"
  | "multi";

export type EntryFrequency =
  | "once"
  | "daily"
  | "weekly"
  | "unlimited";

export type PrizeCategory =
  | "cash"
  | "electronics"
  | "travel"
  | "automotive"
  | "gift_card"
  | "home"
  | "fashion"
  | "food"
  | "experience"
  | "subscription"
  | "other";

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

export interface Contest {
  id: string;
  externalId: string;
  url: string;
  title: string;
  sponsor: string | null;
  description: string | null;
  source: string | null;
  sourceUrl: string | null;
  type: ContestType;
  entryMethod: EntryMethod;
  status: ContestStatus;
  startDate: string | null;
  endDate: string | null;
  entryFrequency: EntryFrequency | null;
  maxEntries: number | null;
  prizeDescription: string | null;
  prizeValue: number | null;
  prizeCategory: PrizeCategory | null;
  ageRequirement: number;
  geoRestrictions: GeoRestrictions;
  requiresCaptcha: boolean;
  requiresEmailConfirm: boolean;
  requiresSmsVerify: boolean;
  requiresSocialAction: boolean;
  socialActions: SocialAction[];
  termsUrl: string | null;
  difficultyScore: number | null;
  legitimacyScore: number | null;
  priorityScore: number | null;
  formMapping: Record<string, string>;
  screenshotPath: string | null;
  lastCheckedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export interface GeoRestrictions {
  countries?: string[];
  states?: string[];
  excludedCountries?: string[];
  excludedStates?: string[];
}

export interface SocialAction {
  platform: string;
  actionType: "follow" | "like" | "retweet" | "share" | "comment" | "subscribe" | "tag";
  target: string;
  required: boolean;
}

// ---------------------------------------------------------------------------
// Input / filter types
// ---------------------------------------------------------------------------

export interface ContestCreateInput {
  url: string;
  title: string;
  type: ContestType;
  entryMethod: EntryMethod;
  sponsor?: string;
  description?: string;
  source?: string;
  sourceUrl?: string;
  startDate?: string;
  endDate?: string;
  entryFrequency?: EntryFrequency;
  maxEntries?: number;
  prizeDescription?: string;
  prizeValue?: number;
  prizeCategory?: PrizeCategory;
  ageRequirement?: number;
  geoRestrictions?: GeoRestrictions;
  requiresCaptcha?: boolean;
  requiresEmailConfirm?: boolean;
  requiresSmsVerify?: boolean;
  requiresSocialAction?: boolean;
  socialActions?: SocialAction[];
  termsUrl?: string;
  formMapping?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface ContestUpdateInput {
  title?: string;
  sponsor?: string;
  description?: string;
  status?: ContestStatus;
  startDate?: string;
  endDate?: string;
  entryFrequency?: EntryFrequency;
  maxEntries?: number;
  prizeDescription?: string;
  prizeValue?: number;
  prizeCategory?: PrizeCategory;
  difficultyScore?: number;
  legitimacyScore?: number;
  priorityScore?: number;
  formMapping?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface ContestFilter {
  status?: ContestStatus | ContestStatus[];
  type?: ContestType | ContestType[];
  entryMethod?: EntryMethod | EntryMethod[];
  minPrizeValue?: number;
  maxPrizeValue?: number;
  minLegitimacyScore?: number;
  minPriorityScore?: number;
  endsBefore?: string;
  endsAfter?: string;
  requiresCaptcha?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  orderBy?: "priority_score" | "prize_value" | "end_date" | "created_at";
  orderDirection?: "asc" | "desc";
}

export interface ContestWithStats extends Contest {
  totalEntries: number;
  successfulEntries: number;
  failedEntries: number;
  totalCost: number;
  hasWin: boolean;
}

// ---------------------------------------------------------------------------
// Zod schemas for runtime validation at API boundaries
// ---------------------------------------------------------------------------

export const contestTypeSchema = z.enum([
  "sweepstakes",
  "raffle",
  "giveaway",
  "instant_win",
  "contest",
  "daily",
]);

export const contestStatusSchema = z.enum([
  "discovered",
  "queued",
  "active",
  "completed",
  "expired",
  "invalid",
  "blocked",
]);

export const entryMethodSchema = z.enum([
  "form",
  "social",
  "email",
  "purchase",
  "multi",
]);

export const entryFrequencySchema = z.enum([
  "once",
  "daily",
  "weekly",
  "unlimited",
]);

export const prizeCategorySchema = z.enum([
  "cash",
  "electronics",
  "travel",
  "automotive",
  "gift_card",
  "home",
  "fashion",
  "food",
  "experience",
  "subscription",
  "other",
]);

export const geoRestrictionsSchema = z.object({
  countries: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  excludedCountries: z.array(z.string()).optional(),
  excludedStates: z.array(z.string()).optional(),
});

export const socialActionSchema = z.object({
  platform: z.string(),
  actionType: z.enum([
    "follow",
    "like",
    "retweet",
    "share",
    "comment",
    "subscribe",
    "tag",
  ]),
  target: z.string(),
  required: z.boolean(),
});

export const contestCreateSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(500),
  type: contestTypeSchema,
  entryMethod: entryMethodSchema,
  sponsor: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  source: z.string().max(100).optional(),
  sourceUrl: z.string().url().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  entryFrequency: entryFrequencySchema.optional(),
  maxEntries: z.number().int().positive().optional(),
  prizeDescription: z.string().max(2000).optional(),
  prizeValue: z.number().nonnegative().optional(),
  prizeCategory: prizeCategorySchema.optional(),
  ageRequirement: z.number().int().min(0).max(100).optional(),
  geoRestrictions: geoRestrictionsSchema.optional(),
  requiresCaptcha: z.boolean().optional(),
  requiresEmailConfirm: z.boolean().optional(),
  requiresSmsVerify: z.boolean().optional(),
  requiresSocialAction: z.boolean().optional(),
  socialActions: z.array(socialActionSchema).optional(),
  termsUrl: z.string().url().optional(),
  formMapping: z.record(z.string(), z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const contestUpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  sponsor: z.string().max(200).optional(),
  description: z.string().max(5000).optional(),
  status: contestStatusSchema.optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  entryFrequency: entryFrequencySchema.optional(),
  maxEntries: z.number().int().positive().optional(),
  prizeDescription: z.string().max(2000).optional(),
  prizeValue: z.number().nonnegative().optional(),
  prizeCategory: prizeCategorySchema.optional(),
  difficultyScore: z.number().min(0).max(1).optional(),
  legitimacyScore: z.number().min(0).max(1).optional(),
  priorityScore: z.number().min(0).max(1).optional(),
  formMapping: z.record(z.string(), z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const contestFilterSchema = z.object({
  status: z
    .union([contestStatusSchema, z.array(contestStatusSchema)])
    .optional(),
  type: z
    .union([contestTypeSchema, z.array(contestTypeSchema)])
    .optional(),
  entryMethod: z
    .union([entryMethodSchema, z.array(entryMethodSchema)])
    .optional(),
  minPrizeValue: z.number().nonnegative().optional(),
  maxPrizeValue: z.number().nonnegative().optional(),
  minLegitimacyScore: z.number().min(0).max(1).optional(),
  minPriorityScore: z.number().min(0).max(1).optional(),
  endsBefore: z.string().datetime().optional(),
  endsAfter: z.string().datetime().optional(),
  requiresCaptcha: z.boolean().optional(),
  search: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
  orderBy: z
    .enum(["priority_score", "prize_value", "end_date", "created_at"])
    .optional(),
  orderDirection: z.enum(["asc", "desc"]).optional(),
});
