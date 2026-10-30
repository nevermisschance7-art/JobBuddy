import "server-only";
import type { Resume } from "@jobbuddy/shared";
import type { createClient } from "@/lib/supabase/server";
import { approveWithFiles } from "./files";
import { tailorByRules, tailorResume, type TailorJob } from "./tailor";

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
    .select("cv_approved_at, tailored_cv_pdf")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!app) return { error: "I can't find this application." };
  if (app.cv_approved_at && app.tailored_cv_pdf) return {};

  const tailored = await tailorResume(supabase, userId, source, job);
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
