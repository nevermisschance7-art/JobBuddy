import { AppHeader } from "@/components/app-header";
import { Board, type BoardItem } from "@/components/applications/board";
import { MascotSays } from "@/components/mascot";
import { loadProfile } from "@/lib/data";

export const metadata = { title: "Applications · JobBuddy" };

export default async function ApplicationsPage() {
  const { supabase, user, profile } = await loadProfile();
  const { data } = await supabase
    .from("applications")
    .select("id,status,applied_at,notes,updated_at,jobs(title,company_name,apply_url)")
    .eq("user_id", user.id)
    .neq("status", "withdrawn")
    .order("updated_at", { ascending: false });
  const items = (data ?? []) as unknown as BoardItem[];

  return (
    <>
      <AppHeader username={profile?.username ?? null} />
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold">Applications</h1>
          <p className="text-muted-foreground text-sm">
            Move a card when something changes. Reply tracking will move them for you later.
          </p>
        </div>
        {items.length === 0 ? (
          <MascotSays mood="happy">
            No applications yet. Pick a job and press &quot;Prepare application&quot; to start one.
          </MascotSays>
        ) : (
          <Board items={items} />
        )}
      </main>
    </>
  );
}
