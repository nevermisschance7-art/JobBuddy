import "server-only";
import { resumeSchema, type Resume } from "@jobbuddy/shared";
import type { requireUser } from "@/lib/data";

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

export type ApplicationJob = { title: string; company_name: string; description_text: string };

/** One application's job, stored answers and the user's confirmed CV (null if none). */
export async function loadApplicationContext(
  supabase: Supabase,
  userId: string,
  applicationId: string | null,
): Promise<{ job: ApplicationJob; source: Resume | null; answers: unknown } | null> {
  if (!applicationId) return null;
  const [{ data: app }, { data: cv }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, answers, jobs(title, company_name, description_text)")
      .eq("id", applicationId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("cvs")
      .select("resume_json")
      .eq("user_id", userId)
      .eq("confirmed", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!app) return null;
  const source = resumeSchema.safeParse(cv?.resume_json);
  return {
    job: app.jobs as unknown as ApplicationJob,
    source: source.success ? source.data : null,
    answers: app.answers,
  };
}
