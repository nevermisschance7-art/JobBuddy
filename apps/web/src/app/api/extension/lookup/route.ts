import { NextResponse } from "next/server";
import { z } from "zod";
import { extensionUser, unauthorized } from "@/lib/extension/auth";
import { fillData, findJobForUrl } from "@/lib/extension/jobs";

// POST { url }: the job and prepared application behind an application page, with what the
// extension needs to fill the form. { job: null } when the job isn't known yet.

const body = z.object({ url: z.string().url().max(2000) });

export async function POST(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { supabase, userId } = auth;

  const job = await findJobForUrl(supabase, parsed.data.url);
  if (!job) return NextResponse.json({ job: null, application: null });

  const { data: app } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", userId)
    .eq("job_id", job.id)
    .maybeSingle();
  const application = app ? await fillData(supabase, userId, app.id) : null;
  return NextResponse.json({
    job: { id: job.id, title: job.title, company: job.company_name },
    application,
    reviewUrl: app ? `${new URL(request.url).origin}/applications/${app.id}` : null,
  });
}
