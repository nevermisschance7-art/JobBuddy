"use server";

import { applicationStatusSchema } from "@jobbuddy/shared";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/data";

/** Manual status change on the board. Moving to "applied" stamps the date once. */
export async function moveApplication(applicationId: string, status: string): Promise<void> {
  const parsed = applicationStatusSchema.safeParse(status);
  if (!parsed.success) return;
  const { supabase, user } = await requireUser();

  const { data: app } = await supabase
    .from("applications")
    .select("job_id, applied_at")
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .single();
  if (!app) return;

  const appliedAt =
    parsed.data !== "prepared" && parsed.data !== "withdrawn" && !app.applied_at
      ? new Date().toISOString()
      : app.applied_at;
  await supabase
    .from("applications")
    .update({ status: parsed.data, applied_at: appliedAt })
    .eq("id", applicationId)
    .eq("user_id", user.id);
  if (parsed.data !== "prepared") {
    await supabase
      .from("user_job_matches")
      .update({ status: "applied" })
      .eq("user_id", user.id)
      .eq("job_id", app.job_id);
  }
  revalidatePath("/applications");
}

export async function saveNotes(applicationId: string, notes: string): Promise<void> {
  const { supabase, user } = await requireUser();
  await supabase
    .from("applications")
    .update({ notes: notes.slice(0, 2000) })
    .eq("id", applicationId)
    .eq("user_id", user.id);
  revalidatePath("/applications");
}
