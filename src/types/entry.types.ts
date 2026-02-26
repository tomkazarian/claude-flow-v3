import { z } from "zod";
import type { Contest } from "./contest.types.js";

// ---------------------------------------------------------------------------
// String literal unions
// ---------------------------------------------------------------------------

export type EntryStatus =
  | "pending"
  | "submitted"
  | "confirmed"
  | "failed"
  | "won"
  | "lost"
  | "expired"
  | "duplicate";

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

export interface Entry {
  id: string;
  contestId: string;
  profileId: string;
  status: EntryStatus;
  attemptNumber: number;
  entryMethod: string | null;
  proxyUsed: string | null;
  fingerprintId: string | null;
  captchaSolved: boolean;
  captchaType: string | null;
  captchaCost: number | null;
  emailConfirmed: boolean;
  smsVerified: boolean;
  socialCompleted: boolean;
  screenshotPath: string | null;
  errorMessage: string | null;
  errorScreenshot: string | null;
  durationMs: number | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Input / result types
// ---------------------------------------------------------------------------

export interface EntryCreateInput {
  contestId: string;
  profileId: string;
  entryMethod?: string;
  proxyUsed?: string;
  fingerprintId?: string;
}

export interface EntryResult {
  entryId: string;
  contestId: string;
  profileId: string;
  status: EntryStatus;
  attemptNumber: number;
  captchaSolved: boolean;
  captchaCost: number | null;
  emailConfirmed: boolean;
  smsVerified: boolean;
  socialCompleted: boolean;
  durationMs: number | null;
  errorMessage: string | null;
  screenshotPath: string | null;
  submittedAt: string | null;
}

// ---------------------------------------------------------------------------
// Filter / stats types
// ---------------------------------------------------------------------------

export interface EntryFilter {
  contestId?: string;
  profileId?: string;
  status?: EntryStatus | EntryStatus[];
  entryMethod?: string;
  submittedAfter?: string;
  submittedBefore?: string;
  minDuration?: number;
  maxDuration?: number;
  hadCaptcha?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: "submitted_at" | "created_at" | "duration_ms" | "attempt_number";
  orderDirection?: "asc" | "desc";
}

export interface EntryStats {
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

export interface EntryWithContest extends Entry {
  contest: Pick<
    Contest,
    | "title"
    | "url"
    | "type"
    | "entryMethod"
    | "prizeDescription"
    | "prizeValue"
    | "endDate"
    | "status"
  > | null;
}

// ---------------------------------------------------------------------------
// Zod schemas for runtime validation
// ---------------------------------------------------------------------------

export const entryStatusSchema = z.enum([
  "pending",
  "submitted",
  "confirmed",
  "failed",
  "won",
  "lost",
  "expired",
  "duplicate",
]);

export const entryCreateSchema = z.object({
  contestId: z.string().min(1),
  profileId: z.string().min(1),
  entryMethod: z.string().optional(),
  proxyUsed: z.string().optional(),
  fingerprintId: z.string().optional(),
});

export const entryFilterSchema = z.object({
  contestId: z.string().optional(),
  profileId: z.string().optional(),
  status: z
    .union([entryStatusSchema, z.array(entryStatusSchema)])
    .optional(),
  entryMethod: z.string().optional(),
  submittedAfter: z.string().datetime().optional(),
  submittedBefore: z.string().datetime().optional(),
  minDuration: z.number().int().nonnegative().optional(),
  maxDuration: z.number().int().nonnegative().optional(),
  hadCaptcha: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
  orderBy: z
    .enum(["submitted_at", "created_at", "duration_ms", "attempt_number"])
    .optional(),
  orderDirection: z.enum(["asc", "desc"]).optional(),
});
