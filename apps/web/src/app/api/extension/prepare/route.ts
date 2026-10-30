import { jobKeyFromUrl, pageAddress, resumeSchema, type Json } from "@jobbuddy/shared";
import { NextResponse } from "next/server";
import { z } from "zod";
import { draftAnswers, pickChoices, rememberAnswers, type StoredAnswer } from "@/lib/answers";
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
  /** Choice questions (Yes/No, dropdowns) for the AI to pick from the CV, where it can. */
  choices: z
    .array(
      z.object({
        question: z.string().min(2).max(1000),
        options: z.array(z.string().min(1).max(200)).min(2).max(60),
      }),
    )
    .max(15)
    .default([]),
  /** Later pages of a multi-page form: add to this application (the address differs). */
  applicationId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { supabase, userId } = auth;
  const input = parsed.data;

  // Known employer systems by their job id; any other site by its page address.
  const known = jobKeyFromUrl(input.url);
  const address = pageAddress(input.url);
  if (!known && !address) return NextResponse.json({ error: "Bad page address." }, { status: 400 });
  const externalId = known ? `${known.ats}:${known.id}` : `web:${address}`;

  let found: FoundJob | null = null;
  if (input.applicationId) {
    const { data } = await supabase
      .from("applications")
      .select("jobs(id, title, company_name, description_text)")
      .eq("id", input.applicationId)
      .eq("user_id", userId)
      .maybeSingle();
    found = (data?.jobs as unknown as FoundJob | null) ?? null;
  }
  found ??= await findJobForUrl(supabase, input.url);
  if (!found) {
    // A job the fetchers haven't seen. Jobs are shared and written by the service role; the
    // posting date is unknown, so it is stored as unknown (never the time we saw it).
    const page = new URL(input.url);
    const { data, error } = await createAdminClient()
      .from("jobs")
      .upsert(
        {
          source: "extension",
          external_id: externalId,
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
  let chosen = 0;
  if (input.questions.length > 0 || input.choices.length > 0) {
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
      // Written answers and choice picks: one AI call each, side by side.
      const [fresh, picks] = await Promise.all([
        questions.length > 0
          ? draftAnswers(supabase, userId, job, resume.data, questions)
          : Promise.resolve([] as StoredAnswer[]),
        input.choices.length > 0
          ? pickChoices(supabase, userId, job, resume.data, input.choices).catch(() =>
              input.choices.map(() => null),
            )
          : Promise.resolve([] as (string | null)[]),
      ]);
      const picked: StoredAnswer[] = input.choices.flatMap((c, i) => {
        const answer = picks[i];
        return answer
          ? [{ question: c.question, kind: "drafted" as const, answer, maxWords: 10, choice: true }]
          : [];
      });
      const all = [...fresh, ...picked];
      const before = (Array.isArray(existing?.answers)
        ? existing.answers
        : []) as unknown as StoredAnswer[];
      const seen = new Set(all.map((a) => a.question.toLowerCase()));
      const answers = [...before.filter((a) => !seen.has(a.question.toLowerCase())), ...all];
      await supabase
        .from("applications")
        .update({ answers: answers as unknown as Json })
        .eq("id", applicationId)
        .eq("user_id", userId);
      drafted = fresh.length;
      chosen = picked.length;
      // Kept for next time: the same question on another form is answered without the AI.
      await rememberAnswers(
        supabase,
        userId,
        job.company_name,
        all
          .filter((a) => a.kind === "drafted" && !a.isCoverLetter)
          .map((a) => ({ question: a.question, answer: a.answer })),
      );
    }
  }

  return NextResponse.json({
    applicationId,
    drafted,
    chosen,
    reviewUrl: `${new URL(request.url).origin}/applications/${applicationId}`,
  });
}
