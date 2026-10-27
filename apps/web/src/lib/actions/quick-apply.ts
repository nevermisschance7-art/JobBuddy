"use server";

import { resumeSchema } from "@jobbuddy/shared";
import { revalidatePath } from "next/cache";
import { ensureApprovedCv } from "@/lib/cv/ensure";
import { requireUser } from "@/lib/data";

export type QuickApplyResult =
  | { ok: true; applicationId: string; applyUrl: string; note?: string }
  | { ok: false; error: string };

/**
 * One click: starts the application, tailors the CV (the truth checker still removes
 * anything not in the confirmed CV), approves it and makes the files. The page then opens
 * the employer's form, where the extension fills it. The user still presses Submit.
 */
export async function quickApply(jobId: string): Promise<QuickApplyResult> {
  const { supabase, user } = await requireUser();
  const [{ data: job }, { data: cv }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, company_name, description_text, apply_url")
      .eq("id", jobId)
      .maybeSingle(),
    supabase
      .from("cvs")
      .select("resume_json")
      .eq("user_id", user.id)
      .eq("confirmed", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!job) return { ok: false, error: "This job is gone. It may have closed." };
  const source = resumeSchema.safeParse(cv?.resume_json);
  if (!source.success) {
    return { ok: false, error: "Confirm your CV in Settings first. I only tailor from it." };
  }

  let { data: app } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", user.id)
    .eq("job_id", job.id)
    .maybeSingle();
  if (!app) {
    const { data: created, error } = await supabase
      .from("applications")
      .insert({ user_id: user.id, job_id: job.id, status: "prepared" })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: "Couldn't start the application." };
    app = created;
  }

  const { error, note } = await ensureApprovedCv(supabase, user.id, app.id, job, source.data);
  if (error) return { ok: false, error };

  await supabase
    .from("user_job_matches")
    .update({ status: "preparing" })
    .eq("user_id", user.id)
    .eq("job_id", job.id)
    .in("status", ["new", "seen", "saved"]);
  revalidatePath("/applications");
  return { ok: true, applicationId: app.id, applyUrl: job.apply_url, note };
}
