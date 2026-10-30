import { GOOD_NEWS } from "@jobbuddy/shared";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { AppList, type AppRow } from "@/components/applications/app-list";
import { DailyColumns } from "@/components/charts/daily-columns";
import { MascotSays } from "@/components/mascot";
import { loadProfile } from "@/lib/data";
import { cn } from "@/lib/utils";

export const metadata = { title: "Applications · JobBuddy" };

const TABS = [
  ["ready", "Ready to apply", ["prepared"]],
  ["applied", "Applied", ["applied"]],
  ["interviewing", "Interviewing", ["assessment", "interview"]],
  ["offers", "Offers", ["offer"]],
  ["closed", "Closed", ["rejected", "ghosted", "withdrawn"]],
  ["all", "All", null],
] as const;
type Tab = (typeof TABS)[number][0];

const PAGE = 25;

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const tab: Tab = TABS.some(([t]) => t === params.tab) ? (params.tab as Tab) : "ready";
  const page = Math.max(1, Number(params.page) || 1);
  const search = (params.q ?? "")
    .replace(/[^\p{L}\p{N} .+#-]/gu, " ")
    .trim()
    .slice(0, 80);
  const { supabase, user, profile } = await loadProfile();
  const { data: activity } = await supabase.rpc("my_daily_activity", { p_days: 10 });

  // Counts per tab, one small query each.
  const { data: statusRows } = await supabase
    .from("applications")
    .select("status")
    .eq("user_id", user.id);
  const counts = Object.fromEntries(
    TABS.map(([t, , statuses]) => [
      t,
      (statusRows ?? []).filter(
        (r) => !statuses || (statuses as readonly string[]).includes(r.status),
      ).length,
    ]),
  ) as Record<Tab, number>;

  const statuses = TABS.find(([t]) => t === tab)![2];
  let q = supabase
    .from("applications")
    .select(
      "id,status,applied_at,created_at,notes,cv_approved_at,jobs!inner(title,company_name,apply_url)",
      { count: "exact" },
    )
    .eq("user_id", user.id);
  if (statuses) q = q.in("status", [...statuses]);
  if (search) {
    q = q.or(`title.ilike.%${search}%,company_name.ilike.%${search}%`, { referencedTable: "jobs" });
  }
  const { data, count } = await q
    .order(tab === "ready" ? "created_at" : "updated_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  const items = (data ?? []) as unknown as AppRow[];

  // The latest good news per application, found in Gmail by the user's mail script.
  if (items.length > 0) {
    const { data: news } = await supabase
      .from("employer_messages")
      .select("application_id, subject, gmail_url")
      .eq("user_id", user.id)
      .in(
        "application_id",
        items.map((i) => i.id),
      )
      .in("classification", [...GOOD_NEWS])
      .order("received_at", { ascending: false });
    for (const n of news ?? []) {
      const item = items.find((i) => i.id === n.application_id);
      if (item && !item.good_news) item.good_news = { subject: n.subject, gmail_url: n.gmail_url };
    }
  }
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const href = (next: Partial<{ tab: string; page: number }>) => {
    const p = new URLSearchParams();
    p.set("tab", next.tab ?? tab);
    if (search) p.set("q", search);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    return `/applications?${p.toString()}`;
  };

  return (
    <>
      <AppHeader username={profile?.username ?? null} />
      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold">Applications</h1>
          <p className="text-muted-foreground text-sm">
            Everything you prepared or applied to. The extension marks a job applied when it sees
            the employer&apos;s confirmation page.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DailyColumns
            title="Jobs posted for you"
            series={1}
            unit="job"
            points={(activity ?? []).map((a) => ({ day: a.day, value: a.jobs_posted }))}
          />
          <DailyColumns
            title="You applied"
            series={2}
            unit="application"
            points={(activity ?? []).map((a) => ({ day: a.day, value: a.applied }))}
          />
        </div>

        <nav aria-label="Application status" className="border-border scroll-x flex gap-1 border-b">
          {TABS.map(([t, label]) => (
            <Link
              key={t}
              href={href({ tab: t, page: 1 })}
              aria-current={t === tab ? "page" : undefined}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm",
                t === tab
                  ? "border-primary text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {label}
              <span className="bg-muted rounded-full px-2 text-xs tabular-nums">{counts[t]}</span>
            </Link>
          ))}
        </nav>

        <form action="/applications" className="flex gap-2">
          <input type="hidden" name="tab" value={tab} />
          <input
            name="q"
            defaultValue={search}
            placeholder="Search title or company"
            aria-label="Search applications"
            className="border-border bg-card h-10 flex-1 rounded-md border px-3 text-sm"
          />
          <button className="border-border bg-card hover:bg-muted rounded-md border px-4 text-sm">
            Search
          </button>
        </form>

        {items.length === 0 ? (
          <MascotSays mood="happy">
            {search
              ? "Nothing matches that search."
              : tab === "ready"
                ? 'Nothing waiting. On a job, press "Quick apply" to get a tailored CV and open the form.'
                : "Nothing here yet."}
          </MascotSays>
        ) : (
          <AppList items={items} />
        )}

        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-center gap-3 text-sm">
            {page > 1 ? (
              <Link href={href({ page: page - 1 })} className="underline">
                Previous
              </Link>
            ) : null}
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={href({ page: page + 1 })} className="underline">
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </main>
    </>
  );
}
