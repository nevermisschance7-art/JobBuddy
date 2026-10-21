import "server-only";
import { resumeSchema, type Resume } from "@jobbuddy/shared";
import { AllProvidersFailedError, LlmOutputError } from "@jobbuddy/shared/llm";
import { z } from "zod";
import { routerFor } from "@/lib/ai/router";
import { cleanResume } from "@/lib/resume-clean";
import type { createClient } from "@/lib/supabase/server";
import { cvTextToResume } from "./to-resume";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const SYSTEM = `You convert the text of a CV into JSON Resume format.
Rules:
- Use only facts written in the CV. Never add, guess or improve anything.
- Keep each bullet point's wording as written. Do not merge or summarise bullets.
- Dates: "YYYY-MM" when the month is known, "YYYY" when only the year is known. Leave out unknown dates. No endDate for a current job.
- Leave out any field the CV doesn't state. Never use empty strings.
- countryCode is a 2-letter ISO code, only if the country is clear.
- Placeholders like {{NAME}} stand for real values: copy them exactly where they belong.`;

const SHAPE = `Return an object with this shape:
{
  "basics": { "name", "label", "email", "phone", "url", "summary",
              "location": { "address", "city", "countryCode", "region" },
              "profiles": [{ "network", "username", "url" }] },
  "work": [{ "name" (company), "position", "location", "url", "startDate", "endDate", "summary", "highlights": [string] }],
  "education": [{ "institution", "area", "studyType", "startDate", "endDate", "score" }],
  "skills": [{ "name" (group), "keywords": [string] }],
  "projects": [{ "name", "description", "url", "startDate", "endDate", "highlights": [string], "keywords": [string] }],
  "languages": [{ "language", "fluency" }],
  "certificates": [{ "name", "issuer", "date" }]
}`;

const tolerantResume = z.preprocess((value) => cleanResume(value), resumeSchema);

export type CvReadResult = { resume: Resume; usedAi: boolean; note?: string };

/**
 * Reads a CV with the AI router. Falls back to the simple rule-based reader when no AI
 * is available, so upload never fails just because a key is missing or out of quota.
 */
export async function readCv(
  supabase: Supabase,
  userId: string,
  cvText: string,
): Promise<CvReadResult> {
  // Contact details found by the simple reader are hidden from the model and restored after.
  const basic = cvTextToResume(cvText);
  try {
    const resume = await routerFor(supabase).generateJson(
      "cv_to_resume",
      tolerantResume,
      `${SHAPE}\n\nCV text:\n"""\n${cvText.slice(0, 30_000)}\n"""`,
      userId,
      {
        system: SYSTEM,
        personal: { name: basic.basics.name, email: basic.basics.email, phone: basic.basics.phone },
      },
    );
    return { resume, usedAi: true };
  } catch (e) {
    if (e instanceof AllProvidersFailedError) {
      return {
        resume: basic,
        usedAi: false,
        note: "I couldn't reach an AI, so I only read the basics. Add a free Gemini key in the AI step to read the rest, or fill it in below.",
      };
    }
    if (e instanceof LlmOutputError) {
      console.error("cv_to_resume output invalid", e.message);
      return {
        resume: basic,
        usedAi: false,
        note: "The AI's reading didn't look right, so I only kept the basics. Fill in the rest below.",
      };
    }
    throw e;
  }
}
