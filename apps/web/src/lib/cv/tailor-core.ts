import {
  applyPlan,
  BULLETS_OLDER,
  BULLETS_RECENT,
  checkTailoredCv,
  numberedCv,
  ruleTailor,
  tailorPlanSchema,
  type Resume,
  type TruthReport,
} from "@jobbuddy/shared";
import {
  AllProvidersFailedError,
  LlmOutputError,
  type LlmRouter,
  type PersonalInfo,
} from "@jobbuddy/shared/llm";

// Pure (no server-only imports) so the AI check workflow can run it against real models.

export type TailorJob = { title: string; company_name: string; description_text: string };

const SYSTEM = `You tailor a candidate's CV for one job, like a careful professional CV writer.
You get the CV with numbered jobs (J0, J1...), bullets (B0, B1...) and projects (P0...).
Return a plan as JSON, not a CV:
{
  "headline": "the candidate's headline for this job",
  "summary": "2 or 3 sentences",
  "skills": [{"name": "group name", "keywords": ["skill copied from the CV", ...]}],
  "work": [{"job": 0, "bullets": [{"from": 3, "text": "bullet B3, reworded for this job"}]}],
  "projects": [0]
}
Rules:
- headline: the role this job is for, in words the CV supports (e.g. "Senior PHP Engineer" when the CV shows senior PHP work), plus at most two of the job's main technologies that the CV has. Never a seniority, title or technology the CV doesn't show.
- summary: why this candidate fits THIS job: the kind of role, years of experience if the CV dates show it, the CV skills that match what the job asks for, and one concrete result from the CV. Only facts from the CV.
- skills: up to 6 groups and about 15 to 25 keywords, copied exactly from the CV's skills, the ones this job asks for first. Leave out skills unrelated to this job.
- work: include EVERY job (J0, J1, ...). For each, choose its most relevant bullets for this job, most relevant first: up to ${BULLETS_RECENT} for J0 and J1, up to ${BULLETS_OLDER} for the others. "from" is the bullet's number. Reword each in the job's language where the CV supports it, keeping every fact, number and technology exactly as in the original. Never merge two bullets, never add a fact, result or number. A job with no bullets gets "bullets": [].
- projects: the numbers of the 0 to 2 projects most relevant to this job.
Style: plain, short, human. Strong verbs, no buzzwords, no em dashes, no "I".
Placeholders like {{NAME}} stand for real values: copy them exactly where they belong.`;

export type TailorResult =
  { ok: true; resume: Resume; report: TruthReport } | { ok: false; error: string };

export function jobText(job: TailorJob): string {
  return `${job.title}\n${job.description_text}`;
}

/** Without an AI: ordered and trimmed for the job by its technologies, then truth-checked. */
export function tailorByRules(
  source: Resume,
  job: TailorJob,
): { resume: Resume; report: TruthReport } {
  return checkTailoredCv(source, ruleTailor(source, job.title, job.description_text), jobText(job));
}

/** The AI plans (headline, summary, skills, bullets per job); the code builds the CV from the
 * plan and the original, and the truth checker removes anything not in the CV. */
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
${numberedCv(source)}

Return the plan as JSON.`;
  try {
    const plan = await router.generateJson("tailor_cv", tailorPlanSchema, prompt, userId, {
      system: SYSTEM,
      personal,
    });
    const built = applyPlan(source, plan, job.title, job.description_text);
    const checked = checkTailoredCv(source, built, jobText(job));
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
