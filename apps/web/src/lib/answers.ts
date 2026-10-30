import "server-only";
import {
  questionSimilarity,
  type ChoiceQuestion,
  type PastAnswer,
  type Resume,
} from "@jobbuddy/shared";
import { personalInfoFor, routerFor } from "@/lib/ai/router";
import type { createClient } from "@/lib/supabase/server";
import {
  draftWithRouter,
  pickChoicesWithRouter,
  type AnswerJob,
  type StoredAnswer,
} from "./answers-core";

export type { AnswerJob, StoredAnswer } from "./answers-core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Drafts answers for one application, with the user's fixed answers and answer memory. */
export async function draftAnswers(
  supabase: Supabase,
  userId: string,
  job: AnswerJob,
  cv: Resume,
  questions: { text: string; coverLetter?: boolean }[],
): Promise<StoredAnswer[]> {
  const [{ data: fixed }, memory] = await Promise.all([
    supabase
      .from("fixed_answers")
      .select("key, value")
      .eq("user_id", userId)
      .is("applies_to_country", null),
    loadMemory(supabase, userId),
  ]);
  return draftWithRouter(
    routerFor(supabase),
    userId,
    job,
    cv,
    questions,
    Object.fromEntries((fixed ?? []).map((f) => [f.key, f.value])),
    memory,
    await personalInfoFor(supabase, userId),
  );
}

/** AI picks for experience/skill choice questions, from the CV (null = left to the user). */
export async function pickChoices(
  supabase: Supabase,
  userId: string,
  job: AnswerJob,
  cv: Resume,
  items: ChoiceQuestion[],
): Promise<(string | null)[]> {
  // The same choice question answered before (by the AI or the user): no AI request.
  const memory = await loadMemory(supabase, userId);
  const out: (string | null)[] = items.map((item) => {
    let best: { answer: string; score: number } | null = null;
    for (const m of memory) {
      const score = questionSimilarity(
        item.question,
        m.question,
        job.company_name,
        m.company ?? undefined,
      );
      if (!best || score > best.score) best = { answer: m.answer, score };
    }
    if (!best || best.score < CHOICE_REUSE) return null;
    const answer = best.answer.trim().toLowerCase();
    return item.options.find((o) => o.trim().toLowerCase() === answer) ?? null;
  });
  const ask = items.filter((_, i) => out[i] === null);
  if (ask.length > 0) {
    const picks = await pickChoicesWithRouter(
      routerFor(supabase),
      userId,
      job,
      cv,
      ask,
      await personalInfoFor(supabase, userId),
    );
    let k = 0;
    for (let i = 0; i < out.length; i++) if (out[i] === null) out[i] = picks[k++] ?? null;
  }
  return out;
}

/** Choice questions reuse an earlier pick only when nearly identical (same options too). */
const CHOICE_REUSE = 0.92;

async function loadMemory(supabase: Supabase, userId: string): Promise<PastAnswer[]> {
  const { data } = await supabase
    .from("answer_memory")
    .select("question_text, final_answer, company")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(500);
  return (data ?? []).map((m) => ({
    question: m.question_text,
    answer: m.final_answer,
    company: m.company,
  }));
}

/**
 * Keeps answers for next time (what the AI wrote or picked, or what the user changed it to),
 * so the same question on another form is answered from memory, not by the AI again. A nearly
 * identical question updates its entry; others are added.
 */
export async function rememberAnswers(
  supabase: Supabase,
  userId: string,
  company: string,
  items: { question: string; answer: string }[],
): Promise<void> {
  const useful = items.filter((i) => i.question.trim().length > 2 && i.answer.trim());
  if (useful.length === 0) return;
  const { data: memory } = await supabase
    .from("answer_memory")
    .select("id, question_text, company")
    .eq("user_id", userId)
    .limit(500);
  for (const item of useful) {
    const same = (memory ?? []).find(
      (m) =>
        questionSimilarity(item.question, m.question_text, company, m.company ?? undefined) >= 0.97,
    );
    if (same) {
      await supabase
        .from("answer_memory")
        .update({ question_text: item.question, final_answer: item.answer, company })
        .eq("id", same.id)
        .eq("user_id", userId);
    } else {
      await supabase.from("answer_memory").insert({
        user_id: userId,
        question_text: item.question,
        final_answer: item.answer,
        company,
      });
    }
  }
}
