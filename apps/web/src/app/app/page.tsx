import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { FiltersForm } from "@/components/forms/filters-form";
import { JobsInbox } from "@/components/jobs/jobs-inbox";
import { loadProfile } from "@/lib/data";
import { loadFilters } from "@/lib/loaders";
import { loadMatches } from "@/lib/matches";

export const metadata = { title: "Jobs · JobBuddy" };

export default async function Dashboard() {
  const { supabase, user, profile } = await loadProfile();
  if (!profile?.onboarded_at) redirect("/onboarding");

  const minScore = profile.min_score;
  const [{ count: cvCount }, initial, { filters }] = await Promise.all([
    supabase
      .from("cvs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("confirmed", true),
    loadMatches(
      supabase,
      user.id,
      minScore,
      {
        view: "inbox",
        maxScore: 100,
        freshness: "any",
        remote: "any",
      },
      0,
    ),
    loadFilters(),
  ]);

  return (
    <>
      <AppHeader username={profile.username} />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold">Your jobs</h1>
          <p className="text-muted-foreground text-sm">
            Remote jobs from the last 2 days that pass your filters, best fit to your CV first. The
            score is how well a job fits your CV (0 to 100).
          </p>
        </div>
        <details id="filters" className="border-border bg-card rounded-xl border">
          <summary className="cursor-pointer px-4 py-3 font-medium">Filters</summary>
          <div className="border-border border-t p-4">
            <FiltersForm filters={filters} minScore={minScore} />
          </div>
        </details>
        <JobsInbox initial={initial} minScore={minScore} hasCv={(cvCount ?? 0) > 0} />
      </main>
    </>
  );
}
