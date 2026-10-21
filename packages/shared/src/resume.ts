import { z } from "zod";

// Subset of the JSON Resume schema (https://jsonresume.org/schema) that JobBuddy uses.
// Dates are kept as strings ("2021", "2021-03", "2021-03-15") exactly as the user wrote them.

const dateString = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "Use YYYY, YYYY-MM or YYYY-MM-DD");

export const resumeBasicsSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  url: z.string().url().optional(),
  summary: z.string().optional(),
  location: z
    .object({
      address: z.string().optional(),
      postalCode: z.string().optional(),
      city: z.string().optional(),
      countryCode: z.string().length(2).optional(),
      region: z.string().optional(),
    })
    .optional(),
  profiles: z
    .array(
      z.object({ network: z.string(), username: z.string().optional(), url: z.string().url() }),
    )
    .default([]),
});

export const resumeWorkSchema = z.object({
  name: z.string().min(1),
  position: z.string().min(1),
  location: z.string().optional(),
  url: z.string().url().optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  summary: z.string().optional(),
  highlights: z.array(z.string()).default([]),
});

export const resumeEducationSchema = z.object({
  institution: z.string().min(1),
  area: z.string().optional(),
  studyType: z.string().optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  score: z.string().optional(),
});

export const resumeSkillSchema = z.object({
  name: z.string().min(1),
  level: z.string().optional(),
  keywords: z.array(z.string()).default([]),
});

export const resumeProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().url().optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  highlights: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
});

export const resumeSchema = z.object({
  basics: resumeBasicsSchema,
  work: z.array(resumeWorkSchema).default([]),
  education: z.array(resumeEducationSchema).default([]),
  skills: z.array(resumeSkillSchema).default([]),
  projects: z.array(resumeProjectSchema).default([]),
  languages: z
    .array(z.object({ language: z.string(), fluency: z.string().optional() }))
    .default([]),
  certificates: z
    .array(
      z.object({ name: z.string(), issuer: z.string().optional(), date: dateString.optional() }),
    )
    .default([]),
});

export type Resume = z.infer<typeof resumeSchema>;
