import { NextResponse } from "next/server";
import { z } from "zod";
import { extensionUser, unauthorized } from "@/lib/extension/auth";
import {
  fillData,
  findJobForUrl,
  findRecentApplicationJob,
  type FoundJob,
} from "@/lib/extension/jobs";

// POST { url, applicationId? }: the job and prepared application behind an application page,
// with what the extension needs to fill the form. With applicationId (the next page of a
// multi-page form, whose address differs) that application is used directly.
// { job: null } when the job isn't known yet; "base" always carries contact details and
// fixed answers.

const body = z.object({
  url: z.string().url().max(2000),
  applicationId: z.string().uuid().optional(),
  /** The page's job title and some text, to recognise a recent application's form. */
  title: z.string().max(300).optional(),
  text: z.string().max(3000).optional(),
});

type JobInfo = Pick<FoundJob, "id" | "title" | "company_name">;

export async function POST(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { supabase, userId } = auth;

  let job: JobInfo | null = null;
  let appId: string | null = null;
  if (parsed.data.applicationId) {
    const { data } = await supabase
      .from("applications")
      .select("id, jobs(id, title, company_name)")
      .eq("id", parsed.data.applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) {
      appId = data.id;
      job = data.jobs as unknown as JobInfo;
    }
  }
  if (!appId) {
    job =
      (await findJobForUrl(supabase, parsed.data.url)) ??
      (await findRecentApplicationJob(supabase, userId, parsed.data));
    if (job) {
      const { data } = await supabase
        .from("applications")
        .select("id")
        .eq("user_id", userId)
        .eq("job_id", job.id)
        .maybeSingle();
      appId = data?.id ?? null;
    }
  }

  const application = appId ? await fillData(supabase, userId, appId) : null;
  return NextResponse.json({
    job: job ? { id: job.id, title: job.title, company: job.company_name } : null,
    application,
    // Contact details and fixed answers, for any form (also jobs not prepared yet).
    base: application ?? (await fillData(supabase, userId, null)),
    reviewUrl: appId ? `${new URL(request.url).origin}/applications/${appId}` : null,
  });
}
