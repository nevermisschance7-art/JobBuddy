import { employerDomains, normalizeCompany } from "@jobbuddy/shared";
import { NextResponse } from "next/server";
import { mailUnauthorized, mailUser } from "@/lib/mail/auth";

// GET: the companies the user applied to in the last 45 days, one entry per company (the
// newest application), with the sender domains that belong to it. The Gmail script uses this
// to match employer replies to applications.

const DAYS = 45;
const PAGE = 1000;
const MAX_ROWS = 10_000;

type Row = {
  id: string;
  jobs: {
    company_name: string;
    apply_url: string;
    canonical_url: string;
    companies: { website: string | null } | null;
  };
};

export async function GET(request: Request) {
  const auth = await mailUser(request);
  if (!auth) return mailUnauthorized();
  const { admin, userId } = auth;

  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const seen = new Set<string>();
  const companies: { applicationId: string; company: string; domains: string[] }[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await admin
      .from("applications")
      .select("id, jobs!inner(company_name, apply_url, canonical_url, companies(website))")
      .eq("user_id", userId)
      .neq("status", "withdrawn")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: "Couldn't load" }, { status: 500 });
    const rows = (data ?? []) as unknown as Row[];
    for (const r of rows) {
      const key = normalizeCompany(r.jobs.company_name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      companies.push({
        applicationId: r.id,
        company: r.jobs.company_name,
        domains: employerDomains(r.jobs.company_name, [
          r.jobs.companies?.website,
          r.jobs.apply_url,
          r.jobs.canonical_url,
        ]),
      });
    }
    if (rows.length < PAGE) break;
  }
  return NextResponse.json({ companies });
}
