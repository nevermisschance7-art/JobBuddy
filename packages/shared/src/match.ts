import { z } from "zod";

export const matchStatusSchema = z.enum([
  "new",
  "seen",
  "saved",
  "dismissed",
  "preparing",
  "applied",
]);

const part = (max: number) => z.object({ points: z.number().min(0).max(max), reason: z.string() });

// Unknown or unverified info never gets full points.
// The score is the technical part only (fit to the CV, 0-100). The other parts are information
// for the job card; location, seniority and sponsorship are pass/fail filters.
export const matchBreakdownSchema = z.object({
  technical: part(100),
  seniority: part(20),
  eligibility: part(20),
  remote: part(10),
  freshness: part(10),
  compensation: part(5),
});

export const matchSchema = z.object({
  userId: z.string().uuid(),
  jobId: z.string().uuid(),
  score: z.number().int().min(0).max(100),
  breakdown: matchBreakdownSchema,
  passedFilters: z.boolean(),
  reasonsFailed: z.array(z.string()),
  status: matchStatusSchema,
  dismissedReason: z.string().nullable(),
});

export type MatchBreakdown = z.infer<typeof matchBreakdownSchema>;
export type Match = z.infer<typeof matchSchema>;
