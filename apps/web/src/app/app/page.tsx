import { resumeSchema, termsIn } from "@jobbuddy/shared";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { FiltersForm } from "@/components/forms/filters-form";
import { JobsInbox } from "@/components/jobs/jobs-inbox";
import { MascotSays } from "@/components/mascot";
import { loadProfile } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";
import { loadFilters } from "@/lib/loaders";
import { countMatches, loadMatches, loadRecentApplied } from "@/lib/matches";

export const metadata = { title: "Jobs · JobBuddy" };

export default async function Dashboard() {
  const { supabase, user, profile } = await loadProfile();
  if (!profile?.onboarded_at) redirect("/onboarding");

  const minScore = profile.min_score;
  const [{ data: cv }, initial, counts, { filters }, recentApplied] = await Promise.all([
    supabase
      .from("cvs")
      .select("resume_json, updated_at")
      .eq("user_id", user.id)
      .eq("confirmed", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadMatches(
      supabase,
      user.id,
      minScore,
      { view: "inbox", maxScore: 100, freshness: "any", remote: "any" },
      0,
    ),
    countMatches(supabase, user.id, minScore),
    loadFilters(),
    loadRecentApplied(supabase, user.id),
  ]);
  const runState = await searchState(
    profile.matched_at ?? null,
    [cv?.updated_at, filters.updated_at].filter((d): d is string => Boolean(d)),
  );
  const resume = resumeSchema.safeParse(cv?.resume_json);
  // Technologies in the CV, to highlight the ones each job asks for.
  const userTerms = resume.success ? [...termsIn(JSON.stringify(resume.data))] : [];

  return (
    <>
      <AppHeader username={profile.username} />
      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold">Find work</h1>
          <p className="text-muted-foreground text-sm">
            Remote jobs posted in the last 7 days that pass your filters, best tech fit to your CV
            first. Quick apply tailors your CV and opens the form; you always press Submit.
          </p>
        </div>
        {resume.success && resume.data.skills.every((g) => g.keywords.length === 0) ? (
          <MascotSays mood="thinking">
            Your CV has no skills listed, so your tech fit scores are weak.{" "}
            <a href="/settings#cv" className="text-primary underline">
              Add your skills
            </a>{" "}
            or press &quot;Fill from my CV again&quot; there.
          </MascotSays>
        ) : null}
        <JobsInbox
          initial={initial}
          minScore={minScore}
          hasCv={Boolean(cv)}
          counts={counts}
          userTerms={userTerms}
          recentApplied={recentApplied}
          matchedAt={profile.matched_at ?? null}
          runState={runState}
          filtersPanel={<FiltersForm filters={filters} />}
        />
      </main>
    </>
  );
}

/**
 * "rescoring" when the CV or filters changed after the last scoring (a run is on its way),
 * "running" when a job search is going on right now, else "idle".
 */
async function searchState(
  matchedAt: string | null,
  changedAt: string[],
): Promise<"idle" | "running" | "rescoring"> {
  if (!matchedAt || changedAt.some((d) => d > matchedAt)) return "rescoring";
  // Worker bookkeeping is service-role only; this reads just whether a run is open.
  const { count } = await createAdminClient()
    .from("source_runs")
    .select("id", { count: "exact", head: true })
    .is("finished_at", null)
    .gte("started_at", new Date(Date.now() - 3_600_000).toISOString());
  return (count ?? 0) > 0 ? "running" : "idle";
}
