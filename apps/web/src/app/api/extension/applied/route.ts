import { NextResponse } from "next/server";
import { z } from "zod";
import { extensionUser, unauthorized } from "@/lib/extension/auth";

// The extension saw the employer's confirmation page after the user pressed Submit.
// Marks the application applied (applied_at is stamped once).

const body = z.object({ applicationId: z.string().uuid() });

export async function POST(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { supabase, userId } = auth;

  const { data: app } = await supabase
    .from("applications")
    .select("id, job_id, status, applied_at")
    .eq("id", parsed.data.applicationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (app.status === "prepared") {
    await supabase
      .from("applications")
      .update({ status: "applied", applied_at: app.applied_at ?? new Date().toISOString() })
      .eq("id", app.id)
      .eq("user_id", userId);
    await supabase
      .from("user_job_matches")
      .update({ status: "applied" })
      .eq("user_id", userId)
      .eq("job_id", app.job_id);
  }
  return NextResponse.json({ ok: true });
}
