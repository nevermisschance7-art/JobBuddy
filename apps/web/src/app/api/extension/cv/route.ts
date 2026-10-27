import { resumeSchema } from "@jobbuddy/shared";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureApprovedCv } from "@/lib/cv/ensure";
import { extensionUser, unauthorized } from "@/lib/extension/auth";

// POST { applicationId }: makes the tailored CV for this application (truth-checked, approved,
// PDF and Word files) unless it already has one. A separate request from answer drafting,
// so each stays well inside the hosting time limit.

const body = z.object({ applicationId: z.string().uuid() });

export async function POST(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { supabase, userId } = auth;

  const [{ data: app }, { data: cv }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, jobs(title, company_name, description_text)")
      .eq("id", parsed.data.applicationId)
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
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const source = resumeSchema.safeParse(cv?.resume_json);
  if (!source.success) {
    return NextResponse.json({ error: "Confirm your CV on JobBuddy first." }, { status: 409 });
  }
  const job = app.jobs as unknown as {
    title: string;
    company_name: string;
    description_text: string;
  };
  const { error, note } = await ensureApprovedCv(supabase, userId, app.id, job, source.data);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true, note: note ?? null });
}
