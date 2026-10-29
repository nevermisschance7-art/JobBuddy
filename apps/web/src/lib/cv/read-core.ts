import { resumeSchema, type Resume } from "@jobbuddy/shared";
import type { LlmRouter, PersonalInfo } from "@jobbuddy/shared/llm";
import { z } from "zod";
import { cleanResume } from "@/lib/resume-clean";

// Pure (no server-only imports) so a workflow can re-read a stored CV with the same reader.

const SYSTEM = `You convert the text of a CV into JSON Resume format.
Rules:
- Use only facts written in the CV. Never add, guess or improve anything.
- Keep each bullet point's wording as written. Do not merge or summarise bullets.
- Copy EVERY skill and technology the CV lists (skills sections, tech lines under roles), grouped as the CV groups them. Never drop the skills section.
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

export const tolerantResume = z.preprocess((value) => cleanResume(value), resumeSchema);

/** The CV text as JSON Resume, read by the AI router. Throws when no AI is available. */
export async function readCvWithRouter(
  router: LlmRouter,
  userId: string,
  cvText: string,
  personal: PersonalInfo,
): Promise<Resume> {
  return router.generateJson(
    "cv_to_resume",
    tolerantResume,
    `${SHAPE}

CV text:
"""
${cvText.slice(0, 30_000)}
"""`,
    userId,
    { system: SYSTEM, personal },
  );
}
