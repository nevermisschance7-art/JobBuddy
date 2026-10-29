import { checkTailoredCv, resumeSchema, type Resume, type TruthReport } from "@jobbuddy/shared";
import {
  AllProvidersFailedError,
  LlmOutputError,
  type LlmRouter,
  type PersonalInfo,
} from "@jobbuddy/shared/llm";
import { z } from "zod";
import { cleanResume } from "@/lib/resume-clean";

// Pure (no server-only imports) so the AI check workflow can run it against real models.

export type TailorJob = { title: string; company_name: string; description_text: string };

const SYSTEM = `You tailor a CV for one job. The CV is JSON Resume. Return the same JSON shape.
You may only:
- choose which bullets, skills and projects to keep, and put the most relevant first,
- reword a bullet so it reads clearly, keeping every fact, number and technology exactly as written,
- write basics.summary, always: 2 or 3 short plain sentences on why this candidate fits THIS job. Name the kind of role, their years of experience if the CV dates show it, the CV skills that match what the job asks for, and one concrete result from the CV. Use only facts in the CV; never claim a skill the CV doesn't show.
You must never:
- add an employer, job title, date, degree, project, skill, technology, number or achievement that is not in the CV,
- change a job title, company name or date,
- drop a job from the work history (you may shorten its bullets).
Style: plain, short, human. No buzzwords. No em dashes. Use the job's wording for skills the CV really has.
Placeholders like {{NAME}} stand for real values: copy them exactly where they belong.`;

const tolerantResume = z.preprocess((value) => cleanResume(value), resumeSchema);

export type TailorResult =
  { ok: true; resume: Resume; report: TruthReport } | { ok: false; error: string };

export function jobText(job: TailorJob): string {
  return `${job.title}\n${job.description_text}`;
}

/** AI picks, orders and rewords; the code truth checker then removes anything not in the CV. */
export async function tailorWithRouter(
  router: LlmRouter,
  userId: string,
  source: Resume,
  job: TailorJob,
  personal: PersonalInfo,
): Promise<TailorResult> {
  const prompt = `Job: ${job.title} at ${job.company_name}
Job description (shortened):
"""
${job.description_text.slice(0, 5000)}
"""

The candidate's confirmed CV:
${JSON.stringify(source)}

Return the tailored CV as JSON.`;
  try {
    const tailored = await router.generateJson("tailor_cv", tolerantResume, prompt, userId, {
      system: SYSTEM,
      personal,
    });
    const checked = checkTailoredCv(source, tailored, jobText(job));
    return { ok: true, ...checked };
  } catch (e) {
    if (e instanceof AllProvidersFailedError) {
      // No key at all, or keys that answered "busy" / didn't answer in time.
      return {
        ok: false,
        error:
          e.attempts.length === 0
            ? "I need an AI key to tailor. Add a free Gemini key in Settings, or use your CV as it is."
            : "The AI is busy right now (Google's free Gemini is sometimes overloaded). Try again in a minute, or use your CV as it is.",
      };
    }
    if (e instanceof LlmOutputError) {
      console.error("tailor_cv output invalid", e.message);
      return {
        ok: false,
        error: "The AI's answer didn't look right. Try again, or use your CV as it is.",
      };
    }
    console.error("tailor_cv failed", e);
    return { ok: false, error: "Tailoring failed. Try again later, or use your CV as it is." };
  }
}
