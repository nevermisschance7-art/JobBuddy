import { jobKeyFromUrl, resumeSchema, type Json } from "@jobbuddy/shared";
import { NextResponse } from "next/server";
import { z } from "zod";
import { draftAnswers, type StoredAnswer } from "@/lib/answers";
import { extensionUser, unauthorized } from "@/lib/extension/auth";
import { findJobForUrl, type FoundJob } from "@/lib/extension/jobs";
import { createAdminClient } from "@/lib/supabase/server";

// "Prepare this one" from the extension: the form's questions are sent here. Finds or adds
// the job, starts the application, drafts answers, and says it's ready to review. The user
// then checks the CV and answers on the website. Nothing is ever submitted.

const body = z.object({
  url: z.string().url().max(2000),
  title: z.string().min(1).max(300),
  company: z.string().min(1).max(200),
  description: z.string().max(20_000).default(""),
  questions: z.array(z.string().min(2).max(1000)).max(40).default([]),
});

export async function POST(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { supabase, userId } = auth;
  const input = parsed.data;

  const key = jobKeyFromUrl(input.url);
  if (!key)
    return NextResponse.json({ error: "This isn't an application page I know." }, { status: 400 });

  let found = await findJobForUrl(supabase, input.url);
  if (!found) {
    // A job the fetchers haven't seen. Jobs are shared and written by the service role; the
    // posting date is unknown, so it is stored as unknown (never the time we saw it).
    const page = new URL(input.url);
    const { data, error } = await createAdminClient()
      .from("jobs")
      .upsert(
        {
          source: "extension",
          external_id: `${key.ats}:${key.id}`,
          canonical_url: `${page.origin}${page.pathname}`,
          apply_url: input.url,
          title: input.title,
          company_name: input.company,
          description_text: input.description.slice(0, 6000),
          posted_at: null,
          date_source: "unknown",
        },
        { onConflict: "source,external_id" },
      )
      .select("id, title, company_name, description_text")
      .single();
    if (error || !data) {
      console.error("extension job insert failed", error?.message);
      return NextResponse.json({ error: "Couldn't save this job. Try again." }, { status: 500 });
    }
    found = data as FoundJob;
  }
  const job: FoundJob = found;

  const { data: existing } = await supabase
    .from("applications")
    .select("id, answers")
    .eq("user_id", userId)
    .eq("job_id", job.id)
    .maybeSingle();
  let applicationId = existing?.id;
  if (!applicationId) {
    const { data: created, error } = await supabase
      .from("applications")
      .insert({ user_id: userId, job_id: job.id, status: "prepared" })
      .select("id")
      .single();
    if (error || !created)
      return NextResponse.json({ error: "Couldn't start the application." }, { status: 500 });
    applicationId = created.id;
  }

  let drafted = 0;
  if (input.questions.length > 0) {
    const { data: cv } = await supabase
      .from("cvs")
      .select("resume_json")
      .eq("user_id", userId)
      .eq("confirmed", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const resume = resumeSchema.safeParse(cv?.resume_json);
    if (resume.success) {
      const questions = [...new Set(input.questions.map((q: string) => q.trim()))].map((text) => ({
        text,
      }));
      const fresh = await draftAnswers(supabase, userId, job, resume.data, questions);
      const before = (Array.isArray(existing?.answers)
        ? existing.answers
        : []) as unknown as StoredAnswer[];
      const seen = new Set(fresh.map((a) => a.question.toLowerCase()));
      const answers = [...before.filter((a) => !seen.has(a.question.toLowerCase())), ...fresh];
      await supabase
        .from("applications")
        .update({ answers: answers as unknown as Json })
        .eq("id", applicationId)
        .eq("user_id", userId);
      drafted = fresh.length;
    }
  }

  await supabase.from("events").insert({
    user_id: userId,
    type: "application_ready",
    payload: { title: job.title, application_id: applicationId },
  });

  return NextResponse.json({
    applicationId,
    drafted,
    reviewUrl: `${new URL(request.url).origin}/applications/${applicationId}`,
  });
}
