import "server-only";
import type { PastAnswer, Resume } from "@jobbuddy/shared";
import { personalInfoFor, routerFor } from "@/lib/ai/router";
import type { createClient } from "@/lib/supabase/server";
import { draftWithRouter, type AnswerJob, type StoredAnswer } from "./answers-core";

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
  const [{ data: fixed }, { data: memory }] = await Promise.all([
    supabase
      .from("fixed_answers")
      .select("key, value")
      .eq("user_id", userId)
      .is("applies_to_country", null),
    supabase
      .from("answer_memory")
      .select("question_text, final_answer, company")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(300),
  ]);
  return draftWithRouter(
    routerFor(supabase),
    userId,
    job,
    cv,
    questions,
    Object.fromEntries((fixed ?? []).map((f) => [f.key, f.value])),
    (memory ?? []).map<PastAnswer>((m) => ({
      question: m.question_text,
      answer: m.final_answer,
      company: m.company,
    })),
    await personalInfoFor(supabase, userId),
  );
}
