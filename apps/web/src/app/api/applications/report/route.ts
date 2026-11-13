import { NextResponse, type NextRequest } from "next/server";
import { dayStart, nextDay, reportCsv, reportRange, type ReportRow } from "@/lib/report";
import { getUser } from "@/lib/supabase/server";

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD: the jobs applied to in those days (the user's own
// calendar) as a CSV file, to show a manager.

export async function GET(request: NextRequest) {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: profile } = await supabase
    .from("profiles")
    .select("time_zone")
    .eq("user_id", user.id)
    .maybeSingle();
  const zone = profile?.time_zone ?? null;
  const p = request.nextUrl.searchParams;
  const { from, to } = reportRange(p.get("from") ?? undefined, p.get("to") ?? undefined, zone);

  const { data } = await supabase
    .from("applications")
    .select("applied_at,status,jobs(title,company_name,apply_url,source)")
    .eq("user_id", user.id)
    .gte("applied_at", dayStart(from, zone))
    .lt("applied_at", dayStart(nextDay(to), zone))
    .order("applied_at", { ascending: true })
    .limit(5000);

  return new NextResponse(reportCsv((data ?? []) as unknown as ReportRow[], zone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="applied-jobs-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
