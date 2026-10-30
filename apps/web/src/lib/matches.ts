import "server-only";
import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;
import { companyKey, type AppliedBefore } from "@/lib/company";

export const PAGE_SIZE = 20;

export const JOB_SOURCES = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "teamtailor",
  "adzuna",
  "reed",
  "jooble",
  "remotive",
  "himalayas",
  "arbeitnow",
  "weworkremotely",
] as const;

export const matchQuerySchema = z.object({
  view: z.enum(["inbox", "new", "saved", "hidden"]).default("inbox"),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).default(100),
  freshness: z.enum(["any", "new", "recent", "week"]).default("any"),
  remote: z.enum(["any", "remote", "hybrid", "onsite"]).default("any"),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  company: z.string().max(80).optional(),
  source: z
    .enum(JOB_SOURCES)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  search: z.string().max(80).optional(),
});

export type MatchQuery = z.infer<typeof matchQuerySchema>;

export type MatchCard = {
  id: string;
  job_id: string;
  score: number;
  status: string;
  explanation: string | null;
  breakdown: {
    top_reasons?: string[];
    note?: string | null;
    eligibility?: { chip?: string; reason?: string };
  } & Record<string, unknown>;
  jobs: {
    id: string;
    title: string;
    company_name: string;
    countries: string[];
    remote_regions: string[];
    remote_type: string | null;
    posted_at: string | null;
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string | null;
    source: string;
    apply_url: string;
    description_text: string;
  };
};

const JOB_COLUMNS =
  "id,title,company_name,countries,remote_regions,remote_type,posted_at,salary_min,salary_max,salary_currency,source,apply_url,description_text";

/** Safe for PostgREST filter strings: letters, digits, spaces and a few symbols only. */
function clean(text: string | undefined): string | null {
  const t = (text ?? "").replace(/[^\p{L}\p{N} .+#-]/gu, " ").trim();
  return t.length > 0 ? t : null;
}

export async function loadMatches(
  supabase: Supabase,
  userId: string,
  defaultMin: number,
  query: MatchQuery,
  offset: number,
): Promise<MatchCard[]> {
  let q = supabase
    .from("user_job_matches")
    .select(`id,job_id,score,status,explanation,breakdown,jobs!inner(${JOB_COLUMNS})`)
    .eq("user_id", userId)
    .eq("passed_filters", true)
    .is("jobs.closed_at", null)
    .gte("score", query.minScore ?? defaultMin)
    .lte("score", query.maxScore);

  if (query.view === "new") q = q.eq("status", "new");
  else if (query.view === "saved") q = q.eq("status", "saved");
  else if (query.view === "hidden") q = q.eq("status", "dismissed");
  else q = q.in("status", ["new", "seen", "preparing"]);

  if (query.remote !== "any") q = q.eq("jobs.remote_type", query.remote);
  if (query.country) q = q.contains("jobs.countries", [query.country]);
  if (query.source) q = q.eq("jobs.source", query.source);
  const company = clean(query.company);
  if (company) q = q.ilike("jobs.company_name", `%${company}%`);
  const search = clean(query.search);
  if (search) {
    q = q.or(`title.ilike.%${search}%,company_name.ilike.%${search}%`, { referencedTable: "jobs" });
  }

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  if (query.freshness === "new") q = q.gte("jobs.posted_at", hoursAgo(24));
  else if (query.freshness === "recent") q = q.gte("jobs.posted_at", hoursAgo(72));
  else if (query.freshness === "week") q = q.gte("jobs.posted_at", hoursAgo(24 * 7));

  const { data, error } = await q
    .order("score", { ascending: false })
    .order("id")
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) throw new Error(`Loading matches failed: ${error.message}`);
  return (data ?? []) as unknown as MatchCard[];
}

export type MatchCounts = {
  inbox: number;
  new: number;
  saved: number;
  hidden: number;
  below: number;
};

/** Sidebar counts. "below": jobs that pass the filters but score under the user's minimum. */
export async function countMatches(
  supabase: Supabase,
  userId: string,
  minScore: number,
): Promise<MatchCounts> {
  const base = () =>
    supabase
      .from("user_job_matches")
      .select("id, jobs!inner(id)", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("passed_filters", true)
      .is("jobs.closed_at", null);
  const [inbox, fresh, saved, hidden, below] = await Promise.all([
    base().gte("score", minScore).in("status", ["new", "seen", "preparing"]),
    base().gte("score", minScore).eq("status", "new"),
    base().eq("status", "saved"),
    base().eq("status", "dismissed"),
    base().lt("score", minScore).in("status", ["new", "seen"]),
  ]);
  return {
    inbox: inbox.count ?? 0,
    new: fresh.count ?? 0,
    saved: saved.count ?? 0,
    hidden: hidden.count ?? 0,
    below: below.count ?? 0,
  };
}

/** Companies the user applied to in the last 30 days, by companyKey, newest application first. */
export async function loadRecentApplied(
  supabase: Supabase,
  userId: string,
): Promise<Record<string, AppliedBefore>> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await supabase
    .from("applications")
    .select("applied_at, jobs!inner(id, title, company_name)")
    .eq("user_id", userId)
    .gte("applied_at", since)
    .order("applied_at", { ascending: false })
    .limit(500);
  const out: Record<string, AppliedBefore> = {};
  for (const a of data ?? []) {
    const job = a.jobs as unknown as { id: string; title: string; company_name: string };
    const key = companyKey(job.company_name);
    if (key && a.applied_at && !out[key])
      out[key] = {
        jobId: job.id,
        title: job.title.replace(/\s+/g, " ").trim(),
        appliedAt: a.applied_at,
      };
  }
  return out;
}
