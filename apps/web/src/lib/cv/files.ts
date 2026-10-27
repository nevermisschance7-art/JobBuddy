import "server-only";
import type { Json, Resume, TruthReport } from "@jobbuddy/shared";
import type { createClient } from "@/lib/supabase/server";
import { renderDocx, renderPdf } from "./render";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Renders the (already truth-checked) CV as PDF and Word, stores both, and marks the
 * application's CV approved. Returns an error message, or null when done.
 */
export async function approveWithFiles(
  supabase: Supabase,
  userId: string,
  applicationId: string,
  resume: Resume,
  report: TruthReport,
): Promise<string | null> {
  const base = `${userId}/application-${applicationId}`;
  const [pdf, docx] = await Promise.all([renderPdf(resume), renderDocx(resume)]);
  const uploads = await Promise.all([
    supabase.storage
      .from("cvs")
      .upload(`${base}.pdf`, pdf, { contentType: "application/pdf", upsert: true }),
    supabase.storage.from("cvs").upload(`${base}.docx`, docx, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    }),
  ]);
  if (uploads.some((u) => u.error)) {
    console.error(
      "tailored CV upload failed",
      uploads.map((u) => u.error?.message),
    );
    return "Saving the files failed. Try again.";
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("applications")
    .update({
      tailored_resume_json: resume as unknown as Json,
      tailor_report: report as unknown as Json,
      tailored_at: now,
      tailored_cv_pdf: `${base}.pdf`,
      tailored_cv_docx: `${base}.docx`,
      cv_approved_at: now,
    })
    .eq("id", applicationId)
    .eq("user_id", userId);
  return error ? "Saving failed. Try again." : null;
}
