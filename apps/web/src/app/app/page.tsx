import { resumeSchema, termsIn } from "@jobbuddy/shared";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { FiltersForm } from "@/components/forms/filters-form";
import { JobsInbox } from "@/components/jobs/jobs-inbox";
import { loadProfile } from "@/lib/data";
import { loadFilters } from "@/lib/loaders";
import { countMatches, loadMatches } from "@/lib/matches";

export const metadata = { title: "Jobs · JobBuddy" };

export default async function Dashboard() {
  const { supabase, user, profile } = await loadProfile();
  if (!profile?.onboarded_at) redirect("/onboarding");

  const minScore = profile.min_score;
  const [{ data: cv }, initial, counts, { filters }] = await Promise.all([
    supabase
      .from("cvs")
      .select("resume_json")
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
  ]);
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
        <JobsInbox
          initial={initial}
          minScore={minScore}
          hasCv={Boolean(cv)}
          counts={counts}
          userTerms={userTerms}
          matchedAt={profile.matched_at ?? null}
          filtersPanel={<FiltersForm filters={filters} minScore={minScore} />}
        />
      </main>
    </>
  );
}
