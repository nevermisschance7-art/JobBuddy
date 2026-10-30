import "server-only";
import type { Resume } from "@jobbuddy/shared";
import type { createClient } from "@/lib/supabase/server";
import { approveWithFiles, saveCoverLetter } from "./files";
import { tailorByRules, tailorResume, writeCoverLetter, type TailorJob } from "./tailor";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Makes sure the application has an approved CV with files: tailors it (the truth checker
 * removes anything not in the confirmed CV), or, when no AI is available, orders and trims it
 * for the job by rules.
 * Does nothing when it is already approved.
 */
export async function ensureApprovedCv(
  supabase: Supabase,
  userId: string,
  applicationId: string,
  job: TailorJob,
  source: Resume,
): Promise<{ error?: string; note?: string }> {
  const { data: app } = await supabase
    .from("applications")
    .select("cv_approved_at, tailored_cv_pdf, cover_letter_pdf")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!app) return { error: "I can't find this application." };
  const hasCv = Boolean(app.cv_approved_at && app.tailored_cv_pdf);
  const hasLetter = Boolean(app.cover_letter_pdf);
  if (hasCv && hasLetter) return {};

  // The CV and the cover letter at the same time (two AI requests, one wait).
  const [tailored, letter] = await Promise.all([
    hasCv ? null : tailorResume(supabase, userId, source, job),
    hasLetter ? null : writeCoverLetter(supabase, userId, source, job),
  ]);
  if (letter) {
    // The letter page carries the same name and contact details as the CV.
    const problem = await saveCoverLetter(supabase, userId, applicationId, source, letter.text);
    if (problem) console.error(problem);
  }
  if (!tailored) return {};
  const result = tailored.ok ? tailored : { ...tailorByRules(source, job), ok: true as const };
  const problem = await approveWithFiles(
    supabase,
    userId,
    applicationId,
    result.resume,
    result.report,
  );
  if (problem) return { error: problem };
  return tailored.ok
    ? {}
    : {
        note: `${/need an AI key/.test(tailored.error) ? "No AI key yet" : "The AI was busy"}, so I tailored it by rules: your most relevant skills and experience for this job first.`,
      };
}
