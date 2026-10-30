import { NextResponse } from "next/server";
import { z } from "zod";
import { extensionUser, unauthorized } from "@/lib/extension/auth";
import { findJobForUrl } from "@/lib/extension/jobs";

// POST { url, applicationId?, undo? }: "Not for me" from the extension. Hides the job behind
// this page from the user's board (as on the website); undo shows it again.

const body = z.object({
  url: z.string().url().max(2000),
  applicationId: z.string().uuid().optional(),
  undo: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { supabase, userId } = auth;
  const { url, applicationId, undo } = parsed.data;

  let jobId: string | null = null;
  if (applicationId) {
    const { data: app } = await supabase
      .from("applications")
      .select("job_id")
      .eq("id", applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    jobId = app?.job_id ?? null;
  }
  jobId ??= (await findJobForUrl(supabase, url))?.id ?? null;
  if (!jobId) {
    return NextResponse.json({ hidden: false, reason: "This job isn't in your JobBuddy list." });
  }

  const { data } = await supabase
    .from("user_job_matches")
    .update(
      undo
        ? { status: "seen", dismissed_reason: null }
        : { status: "dismissed", dismissed_reason: "Not for me (from the extension)" },
    )
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .select("id");
  return NextResponse.json({ hidden: !undo && (data?.length ?? 0) > 0, jobId });
}
