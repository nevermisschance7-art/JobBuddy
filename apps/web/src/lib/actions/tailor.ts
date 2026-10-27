"use server";

import { checkTailoredCv, resumeSchema } from "@jobbuddy/shared";
import { revalidatePath } from "next/cache";
import { failed, saved, type ActionState } from "@/lib/action-state";
import { cvFileName } from "@/lib/cv/layout";
import { approveWithFiles } from "@/lib/cv/files";
import { jobText, tailorResume } from "@/lib/cv/tailor";
import { loadApplicationContext as loadContext } from "@/lib/application-context";
import { requireUser } from "@/lib/data";
import { text } from "@/lib/form";
import { cleanResume } from "@/lib/resume-clean";

const NO_CV = "Confirm your CV first (Settings, Your CV). I only tailor from a confirmed CV.";

/** "Tailor with AI" (mode=ai) or "Use my CV as it is": both end with files ready to send. */
export async function prepareCv(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return text(formData, "mode") === "plain" ? keepCvAsIs(formData) : tailorCv(formData);
}

/** AI picks and rewords; the truth checker removes anything invented. */
async function tailorCv(formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const applicationId = text(formData, "application_id");
  const ctx = await loadContext(supabase, user.id, applicationId);
  if (!ctx || !applicationId) return failed("I can't find this application.");
  if (!ctx.source) return failed(NO_CV);

  const result = await tailorResume(supabase, user.id, ctx.source, ctx.job);
  if (!result.ok) return failed(result.error);
  const problem = await approveWithFiles(
    supabase,
    user.id,
    applicationId,
    result.resume,
    result.report,
  );
  if (problem) return failed(problem);
  revalidatePath(`/applications/${applicationId}`);
  const removed = result.report.removed.length + result.report.corrected.length;
  return saved(
    removed > 0
      ? `Tailored and ready. I took out or fixed ${removed} thing${removed === 1 ? "" : "s"} the AI made up.`
      : "Tailored and ready. Download it or open the form.",
  );
}

/** No AI: the confirmed CV unchanged. */
async function keepCvAsIs(formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const applicationId = text(formData, "application_id");
  const ctx = await loadContext(supabase, user.id, applicationId);
  if (!ctx || !applicationId) return failed("I can't find this application.");
  if (!ctx.source) return failed(NO_CV);

  const { report } = checkTailoredCv(ctx.source, ctx.source, jobText(ctx.job));
  const problem = await approveWithFiles(supabase, user.id, applicationId, ctx.source, report);
  if (problem) return failed(problem);
  revalidatePath(`/applications/${applicationId}`);
  return saved("Using your CV as it is. Files ready.");
}

/** "Approve and create files": checks the edited version again, then writes PDF and Word files. */
export async function approveTailored(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const applicationId = text(formData, "application_id");
  const raw = text(formData, "resume_json");
  const ctx = await loadContext(supabase, user.id, applicationId);
  if (!ctx || !applicationId || !raw) return failed("I can't find this application.");
  if (!ctx.source) return failed(NO_CV);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return failed("Something went wrong. Reload the page and try again.");
  }
  const parsed = resumeSchema.safeParse(cleanResume(json));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failed(`Check ${issue?.path.join(" › ") ?? "the form"}: ${issue?.message ?? "invalid"}`);
  }

  // Edits here are checked too: new facts belong in your main CV, not in one application.
  const { resume, report } = checkTailoredCv(ctx.source, parsed.data, jobText(ctx.job));

  const name = cvFileName(resume, ctx.job.company_name);
  const problem = await approveWithFiles(supabase, user.id, applicationId, resume, report);
  if (problem) return failed(problem);

  revalidatePath(`/applications/${applicationId}`);
  const taken = report.removed.length + report.corrected.length;
  return saved(
    taken > 0
      ? `Approved, with ${taken} change${taken === 1 ? "" : "s"} undone because they aren't in your CV. Files ready: ${name}.pdf and .docx.`
      : `Approved. Files ready: ${name}.pdf and .docx.`,
  );
}
