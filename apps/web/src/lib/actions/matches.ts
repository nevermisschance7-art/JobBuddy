"use server";

import { AllProvidersFailedError } from "@jobbuddy/shared/llm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { personalInfoFor, routerFor } from "@/lib/ai/router";
import { requireUser } from "@/lib/data";
import { DISMISS_REASONS, type DismissReason } from "@/lib/dismiss";
import { loadMatches, matchQuerySchema, type MatchCard } from "@/lib/matches";

export async function loadMoreMatches(rawQuery: unknown, offset: number): Promise<MatchCard[]> {
  const { supabase, user } = await requireUser();
  const query = matchQuerySchema.parse(rawQuery);
  const { data: profile } = await supabase
    .from("profiles")
    .select("min_score")
    .eq("user_id", user.id)
    .single();
  return loadMatches(supabase, user.id, profile?.min_score ?? 55, query, Math.max(0, offset));
}

export async function setSaved(jobId: string, saved: boolean): Promise<void> {
  const { supabase, user } = await requireUser();
  await supabase
    .from("user_job_matches")
    .update({ status: saved ? "saved" : "seen" })
    .eq("user_id", user.id)
    .eq("job_id", jobId);
}

/** "Not for me". Optionally skips the whole company from now on. */
export async function dismissMatch(
  jobId: string,
  reason: DismissReason | null,
  note: string,
  skipCompany: string | null,
): Promise<void> {
  const { supabase, user } = await requireUser();
  const label = reason ? DISMISS_REASONS[reason] : null;
  const text = [label, note.trim().slice(0, 200)].filter(Boolean).join(": ") || null;
  await supabase
    .from("user_job_matches")
    .update({ status: "dismissed", dismissed_reason: text })
    .eq("user_id", user.id)
    .eq("job_id", jobId);

  if (skipCompany) {
    const { data: filters } = await supabase
      .from("filters")
      .select("excluded_companies")
      .eq("user_id", user.id)
      .single();
    const current = filters?.excluded_companies ?? [];
    if (!current.some((c) => c.toLowerCase() === skipCompany.toLowerCase())) {
      await supabase
        .from("filters")
        .update({ excluded_companies: [...current, skipCompany.slice(0, 100)] })
        .eq("user_id", user.id);
    }
  }
}

/** Undo of "hide every job from this company": takes it off the skip list again. */
export async function unskipCompany(company: string): Promise<void> {
  const { supabase, user } = await requireUser();
  const { data: filters } = await supabase
    .from("filters")
    .select("excluded_companies")
    .eq("user_id", user.id)
    .single();
  const current = filters?.excluded_companies ?? [];
  await supabase
    .from("filters")
    .update({
      excluded_companies: current.filter((c) => c.toLowerCase() !== company.toLowerCase()),
    })
    .eq("user_id", user.id);
}

// Save, hide and restore don't rebuild the board: the page already shows the change, and a
// rebuild made each click wait for every list and count to load again.
export async function restoreMatch(jobId: string): Promise<void> {
  const { supabase, user } = await requireUser();
  await supabase
    .from("user_job_matches")
    .update({ status: "seen", dismissed_reason: null })
    .eq("user_id", user.id)
    .eq("job_id", jobId);
}

/** On-demand AI explanation, cached on the match. */
export async function explainMatch(jobId: string): Promise<{ text?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  const { data: match } = await supabase
    .from("user_job_matches")
    .select("score, breakdown, explanation, jobs!inner(title, company_name, description_text)")
    .eq("user_id", user.id)
    .eq("job_id", jobId)
    .single();
  if (!match) return { error: "Match not found." };
  if (match.explanation) return { text: match.explanation };

  const { data: cv } = await supabase
    .from("cvs")
    .select("resume_json")
    .eq("user_id", user.id)
    .eq("confirmed", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const resume = (cv?.resume_json ?? {}) as {
    basics?: { label?: string; summary?: string };
    work?: { position?: string; name?: string }[];
    skills?: { keywords?: string[] }[];
  };
  const job = match.jobs as unknown as {
    title: string;
    company_name: string;
    description_text: string;
  };
  const breakdown = match.breakdown as Record<string, { points?: number; reason?: string }>;
  const parts = Object.entries(breakdown)
    .filter(([, v]) => v && typeof v === "object" && "points" in v)
    .map(([k, v]) => `${k}: ${v.points} (${v.reason})`)
    .join("\n");

  const prompt = `Job: ${job.title} at ${job.company_name}
Description (shortened):
"""
${job.description_text.slice(0, 3500)}
"""

The candidate:
Headline: ${resume.basics?.label ?? ""}
Recent roles: ${(resume.work ?? [])
    .slice(0, 3)
    .map((w) => `${w.position} at ${w.name}`)
    .join("; ")}
Skills: ${(resume.skills ?? [])
    .flatMap((s) => s.keywords ?? [])
    .slice(0, 25)
    .join(", ")}

Match score ${match.score}/100, parts:
${parts}

In 2 to 4 short sentences, tell the candidate why this job fits and what might not fit. Speak to them as "you". Only use facts above.`;

  try {
    const result = await routerFor(supabase).generateText("explain_match", prompt, 80, user.id, {
      system: "You explain job matches to a job seeker. Be plain, honest and specific.",
      personal: await personalInfoFor(supabase, user.id),
    });
    await supabase
      .from("user_job_matches")
      .update({ explanation: result.text, explained_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("job_id", jobId);
    return { text: result.text };
  } catch (e) {
    if (e instanceof AllProvidersFailedError) {
      return { error: "I need a working AI key for this. Add one in Settings." };
    }
    console.error("explain_match failed", e);
    return { error: "Couldn't explain this one right now. Try again later." };
  }
}

/** Starts an application (or reopens it) and goes to its page to tailor the CV. */
export async function prepareApplication(jobId: string): Promise<void> {
  const { supabase, user } = await requireUser();
  const { data: existing } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", user.id)
    .eq("job_id", jobId)
    .maybeSingle();
  let applicationId = existing?.id;
  if (!applicationId) {
    const { data: created } = await supabase
      .from("applications")
      .insert({ user_id: user.id, job_id: jobId, status: "prepared" })
      .select("id")
      .single();
    applicationId = created?.id;
  }
  await supabase
    .from("user_job_matches")
    .update({ status: "preparing" })
    .eq("user_id", user.id)
    .eq("job_id", jobId);
  revalidatePath("/app");
  redirect(applicationId ? `/applications/${applicationId}` : "/applications");
}

/** The user opened a job: it is no longer "New". */
export async function markSeen(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const { supabase, user } = await requireUser();
  await supabase
    .from("user_job_matches")
    .update({ status: "seen" })
    .eq("user_id", user.id)
    .eq("status", "new")
    .in("job_id", jobIds.slice(0, 100));
}

/** The job board's Tech fit setting: the lowest score shown. The only place it is set. */
export async function saveMinScore(minScore: number): Promise<void> {
  if (!Number.isInteger(minScore) || minScore < 0 || minScore > 100) return;
  const { supabase, user } = await requireUser();
  await supabase.from("profiles").update({ min_score: minScore }).eq("user_id", user.id);
}
