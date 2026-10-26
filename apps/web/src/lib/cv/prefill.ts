import "server-only";
import type { Resume } from "@jobbuddy/shared";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// After a CV is confirmed, fill settings the CV already answers, so nobody types them twice.
// Only empty settings are filled, never overwritten. Sensitive fixed answers (right to work,
// visa, salary, notice, relocation) are never inferred: only links are taken from the CV.

const LEVELS = ["junior", "mid", "senior", "lead", "principal"] as const;

/** Seniority levels worth showing, from the most recent job title. */
export function levelsFromTitle(title: string | undefined): string[] {
  const t = (title ?? "").toLowerCase();
  if (/\b(principal|staff|distinguished|architect)\b/.test(t))
    return ["senior", "lead", "principal"];
  if (/\b(lead|head of|manager|director)\b/.test(t)) return ["senior", "lead"];
  if (/\b(senior|sr\.?)\b/.test(t)) return ["senior", "lead"];
  if (/\b(junior|jr\.?|graduate|intern|trainee)\b/.test(t)) return ["junior", "mid"];
  if (t.trim()) return ["mid", "senior"];
  return [];
}

/** Profile links from the CV, keyed like fixed answers. */
export function linksFromResume(resume: Resume): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of resume.basics.profiles ?? []) {
    const url = p.url ?? "";
    const network = `${p.network ?? ""} ${url}`.toLowerCase();
    if (network.includes("linkedin") && !out.linkedin_url) out.linkedin_url = url;
    else if (network.includes("github") && !out.github_url) out.github_url = url;
    else if (!out.portfolio_url) out.portfolio_url = url;
  }
  if (resume.basics.url && !out.portfolio_url) out.portfolio_url = resume.basics.url;
  return out;
}

/** Fills empty filters, fixed-answer links and the display name. Returns what was filled. */
export async function prefillFromResume(
  supabase: Supabase,
  userId: string,
  resume: Resume,
): Promise<string[]> {
  const filled: string[] = [];

  const { data: filters } = await supabase
    .from("filters")
    .select("countries_allowed, seniority_levels")
    .eq("user_id", userId)
    .single();
  const update: { countries_allowed?: string[]; seniority_levels?: string[] } = {};
  const country = resume.basics.location?.countryCode?.toUpperCase();
  if (filters && filters.countries_allowed.length === 0 && country && /^[A-Z]{2}$/.test(country)) {
    update.countries_allowed = [country];
    filled.push("your country");
  }
  const latest = [...resume.work].sort((a, b) =>
    (b.startDate ?? "").localeCompare(a.startDate ?? ""),
  )[0];
  const levels = levelsFromTitle(latest?.position).filter((l) =>
    (LEVELS as readonly string[]).includes(l),
  );
  if (filters && filters.seniority_levels.length === 0 && levels.length > 0) {
    update.seniority_levels = levels;
    filled.push("your level");
  }
  if (Object.keys(update).length > 0) {
    await supabase.from("filters").update(update).eq("user_id", userId);
  }

  const links = linksFromResume(resume);
  if (Object.keys(links).length > 0) {
    const { data: existing } = await supabase
      .from("fixed_answers")
      .select("key")
      .eq("user_id", userId)
      .is("applies_to_country", null)
      .in("key", Object.keys(links));
    const have = new Set((existing ?? []).map((r) => r.key));
    const rows = Object.entries(links)
      .filter(([key]) => !have.has(key))
      .map(([key, value]) => ({ user_id: userId, key, value, applies_to_country: null }));
    if (rows.length > 0) {
      await supabase.from("fixed_answers").insert(rows);
      filled.push("your profile links");
    }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("user_id", userId)
    .single();
  const name = resume.basics.name?.trim();
  if (
    profile &&
    name &&
    name !== "-" &&
    (!profile.display_name || profile.display_name === profile.username)
  ) {
    await supabase
      .from("profiles")
      .update({ display_name: name.slice(0, 60) })
      .eq("user_id", userId);
    filled.push("your name");
  }

  return filled;
}
