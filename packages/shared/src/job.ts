import { z } from "zod";

export const jobSources = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "teamtailor",
  "adzuna",
  "reed",
  "jooble",
  "remotive",
  "himalayas",
  "arbeitnow",
  "remoteok",
  "weworkremotely",
] as const;
export const jobSourceSchema = z.enum(jobSources);

export const remoteTypeSchema = z.enum(["remote", "hybrid", "onsite"]);
export const employmentTypeSchema = z.enum([
  "full_time",
  "part_time",
  "contract",
  "temporary",
  "unknown",
]);
export const senioritySchema = z.enum(["junior", "mid", "senior", "lead", "principal", "unknown"]);
export const dateSourceSchema = z.enum(["source_field", "unknown"]);

export const jobLocationSchema = z.object({
  raw: z.string(),
  city: z.string().optional(),
  countryCode: z.string().length(2).optional(),
});

export const jobSchema = z
  .object({
    id: z.string().uuid(),
    source: jobSourceSchema,
    externalId: z.string(),
    canonicalUrl: z.string().url(),
    applyUrl: z.string().url(),
    title: z.string(),
    companyId: z.string().uuid().nullable(),
    companyName: z.string(),
    locations: z.array(jobLocationSchema),
    countries: z.array(z.string().length(2)),
    remoteType: remoteTypeSchema.nullable(),
    employmentType: employmentTypeSchema,
    seniority: senioritySchema,
    salaryMin: z.number().nullable(),
    salaryMax: z.number().nullable(),
    salaryCurrency: z.string().length(3).nullable(),
    descriptionText: z.string(),
    // Only from a real creation/publication field of the source. Never crawl time.
    postedAt: z.string().datetime({ offset: true }).nullable(),
    dateSource: dateSourceSchema,
    firstSeenAt: z.string().datetime({ offset: true }),
    lastSeenAt: z.string().datetime({ offset: true }),
    closedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .refine((j) => (j.postedAt === null) === (j.dateSource === "unknown"), {
    message: "postedAt must be null exactly when dateSource is 'unknown'",
    path: ["postedAt"],
  });

export type Job = z.infer<typeof jobSchema>;
