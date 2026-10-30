import "server-only";
import { AI_PROVIDERS } from "@/lib/ai-keys/validate";
import { resumeSchema, type Resume } from "@jobbuddy/shared";
import type { KeyStatus } from "@/components/forms/ai-keys-form";
import { requireUser } from "@/lib/data";

/** The user's newest CV, with its JSON Resume parsed (or an empty draft if it won't parse). */
export async function loadLatestCv() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("cvs")
    .select("id, confirmed, resume_json, original_file, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const parsed = resumeSchema.safeParse(data.resume_json);
  const resume: Resume = parsed.success
    ? parsed.data
    : resumeSchema.parse({ basics: { name: "-" } });
  return { ...data, resume };
}

export async function loadFilters() {
  const { supabase, user } = await requireUser();
  const [{ data: filters }, { data: profile }] = await Promise.all([
    supabase.from("filters").select("*").eq("user_id", user.id).single(),
    supabase.from("profiles").select("min_score").eq("user_id", user.id).single(),
  ]);
  if (!filters) throw new Error("Filters row missing for user");
  return { filters, minScore: profile?.min_score ?? 55 };
}

export async function loadFixedAnswers(): Promise<Record<string, string>> {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("fixed_answers")
    .select("key, value")
    .eq("user_id", user.id)
    .is("applies_to_country", null);
  return Object.fromEntries((data ?? []).map((a) => [a.key, a.value]));
}

/** Which providers have a key. Never selects the encrypted key itself. */
export async function loadKeyStatuses(): Promise<KeyStatus[]> {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("ai_keys")
    .select("id, provider, key_hint, last_error, quota_reset_at")
    .eq("user_id", user.id)
    .order("created_at");
  const now = new Date().toISOString();
  return AI_PROVIDERS.map((provider) => ({
    provider,
    keys: (data ?? [])
      .filter((k) => k.provider === provider)
      .map((k) => ({
        id: k.id,
        hint: k.key_hint,
        lastError: k.last_error,
        resting: Boolean(k.quota_reset_at && k.quota_reset_at > now),
      })),
  }));
}
