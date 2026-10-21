import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { JobsInbox } from "@/components/jobs/jobs-inbox";
import { loadProfile } from "@/lib/data";
import { loadMatches } from "@/lib/matches";

export const metadata = { title: "Jobs · JobBuddy" };

export default async function Dashboard() {
  const { supabase, user, profile } = await loadProfile();
  if (!profile?.onboarded_at) redirect("/onboarding");

  const minScore = profile.min_score;
  const [{ count: cvCount }, initial] = await Promise.all([
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
  ]);

  return (
    <>
      <AppHeader username={profile.username} />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold">Your jobs</h1>
          <p className="text-muted-foreground text-sm">
            Every job that passes your filters and scores {minScore} or more, best first.
          </p>
        </div>
        <JobsInbox initial={initial} minScore={minScore} hasCv={(cvCount ?? 0) > 0} />
      </main>
    </>
  );
}
