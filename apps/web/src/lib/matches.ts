import "server-only";
import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

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
  "remoteok",
  "weworkremotely",
] as const;

export const matchQuerySchema = z.object({
  view: z.enum(["inbox", "saved", "hidden"]).default("inbox"),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).default(100),
  freshness: z.enum(["any", "new", "recent", "relevant", "older"]).default("any"),
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
  };
};

const JOB_COLUMNS =
  "id,title,company_name,countries,remote_regions,remote_type,posted_at,salary_min,salary_max,salary_currency,source,apply_url";

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

  if (query.view === "saved") q = q.eq("status", "saved");
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
  else if (query.freshness === "relevant") q = q.gte("jobs.posted_at", hoursAgo(24 * 14));
  else if (query.freshness === "older") q = q.lt("jobs.posted_at", hoursAgo(24 * 14));

  const { data, error } = await q
    .order("score", { ascending: false })
    .order("id")
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) throw new Error(`Loading matches failed: ${error.message}`);
  return (data ?? []) as unknown as MatchCard[];
}
