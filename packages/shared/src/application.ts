import { z } from "zod";
import { resumeSchema } from "./resume";

export const applicationStatusSchema = z.enum([
  "prepared",
  "applied",
  "assessment",
  "interview",
  "offer",
  "rejected",
  "ghosted",
  "withdrawn",
]);

export const answerOriginSchema = z.enum(["fixed", "reused", "drafted", "user"]);

export const applicationAnswerSchema = z.object({
  question: z.string(),
  answer: z.string(),
  origin: answerOriginSchema,
  maxWords: z.number().int().positive().optional(),
});

export const applicationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  jobId: z.string().uuid(),
  status: applicationStatusSchema,
  appliedAt: z.string().datetime({ offset: true }).nullable(),
  tailoredCvPdf: z.string().nullable(),
  tailoredCvDocx: z.string().nullable(),
  tailoredResumeJson: resumeSchema.nullable(),
  answers: z.array(applicationAnswerSchema),
  lastReplyAt: z.string().datetime({ offset: true }).nullable(),
  notes: z.string().nullable(),
});

export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
export type ApplicationAnswer = z.infer<typeof applicationAnswerSchema>;
export type Application = z.infer<typeof applicationSchema>;
