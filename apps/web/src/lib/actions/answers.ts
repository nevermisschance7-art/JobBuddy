"use server";

import { questionSimilarity, splitQuestions, type Json } from "@jobbuddy/shared";
import { revalidatePath } from "next/cache";
import { failed, saved, type ActionState } from "@/lib/action-state";
import { draftAnswers, type StoredAnswer } from "@/lib/answers";
import { loadApplicationContext } from "@/lib/application-context";
import { requireUser } from "@/lib/data";
import { FIXED_ANSWER_KEYS } from "@/lib/fixed-answers";
import { text } from "@/lib/form";

const asAnswers = (v: unknown): StoredAnswer[] => (Array.isArray(v) ? (v as StoredAnswer[]) : []);

/** Drafts answers for pasted questions (and a cover letter if asked). Adds to earlier ones. */
export async function draftApplicationAnswers(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const applicationId = text(formData, "application_id");
  const ctx = await loadApplicationContext(supabase, user.id, applicationId);
  if (!ctx || !applicationId) return failed("I can't find this application.");
  if (!ctx.source) return failed("Confirm your CV first. I only write from facts in it.");

  const questions: { text: string; coverLetter?: boolean }[] = splitQuestions(
    text(formData, "questions") ?? "",
  ).map((q) => ({ text: q }));
  if (formData.get("cover_letter") === "on")
    questions.push({ text: "Cover letter", coverLetter: true });
  if (questions.length === 0) return failed("Paste at least one question, one per line.");

  const drafted = await draftAnswers(supabase, user.id, ctx.job, ctx.source, questions);
  const fresh = new Set(drafted.map((d) => d.question.toLowerCase()));
  const answers = [
    ...asAnswers(ctx.answers).filter((a) => !fresh.has(a.question.toLowerCase())),
    ...drafted,
  ];

  const { error } = await supabase
    .from("applications")
    .update({ answers: answers as unknown as Json })
    .eq("id", applicationId)
    .eq("user_id", user.id);
  if (error) return failed("Saving failed. Try again.");
  revalidatePath(`/applications/${applicationId}`);

  const failedCount = drafted.filter((d) => d.kind === "failed").length;
  const missing = drafted.filter((d) => d.kind === "missing_fixed").length;
  const notes = [
    failedCount > 0
      ? `${failedCount} couldn't be drafted (the AI was busy or isn't set up): try again in a minute or write them yourself`
      : "",
    missing > 0 ? `${missing} need${missing === 1 ? "s" : ""} a fixed answer from you` : "",
  ].filter(Boolean);
  return saved(
    notes.length > 0
      ? `Done. ${notes.join("; ")}.`
      : "Done. Check each answer, edit it, then save.",
  );
}

/**
 * Saves the user's final answers. Drafted and reused ones go to answer memory so the next
 * drafts sound like them; a missing fixed answer typed here is saved as a fixed answer.
 */
export async function saveApplicationAnswers(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const applicationId = text(formData, "application_id");
  const ctx = await loadApplicationContext(supabase, user.id, applicationId);
  if (!ctx || !applicationId) return failed("I can't find this application.");

  let finals: { question: string; final: string }[];
  try {
    finals = JSON.parse(text(formData, "finals") ?? "[]");
  } catch {
    return failed("Something went wrong. Reload the page and try again.");
  }
  const byQuestion = new Map(finals.map((f) => [f.question, String(f.final ?? "").slice(0, 5000)]));
  const stored = asAnswers(ctx.answers);
  const answers = stored
    .filter((a) => byQuestion.has(a.question))
    .map((a) => ({ ...a, final: byQuestion.get(a.question)!.trim() }));

  // Missing fixed answers the user just typed: save them for every future form.
  const validKeys = new Set(FIXED_ANSWER_KEYS.map((k) => k.key));
  const newFixed = answers.filter(
    (a) => a.kind === "missing_fixed" && a.fixedKey && validKeys.has(a.fixedKey) && a.final,
  );
  if (newFixed.length > 0) {
    await supabase.from("fixed_answers").upsert(
      newFixed.map((a) => ({
        user_id: user.id,
        key: a.fixedKey!,
        value: a.final.slice(0, 500),
        applies_to_country: null,
      })),
      { onConflict: "user_id,key,applies_to_country" },
    );
    for (const a of newFixed) a.kind = "fixed";
  }

  // Everything else the user wrote or approved becomes their answer memory.
  const learnable = answers.filter(
    (a) =>
      (a.kind === "drafted" || a.kind === "reused" || a.kind === "failed") &&
      a.final &&
      !a.isCoverLetter,
  );
  if (learnable.length > 0) {
    const { data: memory } = await supabase
      .from("answer_memory")
      .select("id, question_text, company, times_reused")
      .eq("user_id", user.id)
      .limit(300);
    for (const a of learnable) {
      const same = (memory ?? []).find(
        (m) =>
          questionSimilarity(
            a.question,
            m.question_text,
            ctx.job.company_name,
            m.company ?? undefined,
          ) >= 0.97,
      );
      if (same) {
        await supabase
          .from("answer_memory")
          .update({
            question_text: a.question,
            final_answer: a.final,
            company: ctx.job.company_name,
            times_reused: same.times_reused + (a.kind === "reused" ? 1 : 0),
          })
          .eq("id", same.id)
          .eq("user_id", user.id);
      } else {
        await supabase.from("answer_memory").insert({
          user_id: user.id,
          question_text: a.question,
          final_answer: a.final,
          company: ctx.job.company_name,
        });
      }
    }
  }

  const { error } = await supabase
    .from("applications")
    .update({ answers: answers as unknown as Json })
    .eq("id", applicationId)
    .eq("user_id", user.id);
  if (error) return failed("Saving failed. Try again.");
  revalidatePath(`/applications/${applicationId}`);
  return saved(
    newFixed.length > 0
      ? `Saved. ${newFixed.length} new fixed answer${newFixed.length === 1 ? "" : "s"} kept for next time too.`
      : "Saved. I'll learn from how you answered.",
  );
}
