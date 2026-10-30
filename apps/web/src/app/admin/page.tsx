import {
  AdminPassword,
  AdminTabGuard,
  AdminUsers,
  type AdminUserRow,
} from "@/components/admin/admin-users";
import { DailyColumns } from "@/components/charts/daily-columns";
import { adminSignOut } from "@/lib/actions/admin";
import { adminAccess } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/server";

export const metadata = { title: "Admin · JobBuddy" };

// Users, their application counts and uploaded CV, with Disable / Enable / Kick / Delete.
export default async function AdminPage() {
  if ((await adminAccess()) === "password") {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-semibold">JobBuddy admin</h1>
        <AdminPassword />
      </main>
    );
  }

  const admin = createAdminClient();
  const [
    { data: auth },
    { data: profiles },
    { data: apps },
    { data: cvs },
    { data: blocked },
    { data: activity },
  ] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from("profiles").select("user_id, username, created_at"),
    admin.from("applications").select("user_id"),
    admin.from("cvs").select("user_id, original_file").not("original_file", "is", null),
    admin.from("blocked_users").select("user_id"),
    admin.rpc("team_daily_activity", { p_days: 10 }),
  ]);
  const aiDays = await aiCallsPerDay(
    admin,
    (activity ?? []).map((a) => a.day),
  );

  const count = new Map<string, number>();
  for (const a of apps ?? []) count.set(a.user_id, (count.get(a.user_id) ?? 0) + 1);
  const withCv = new Set((cvs ?? []).map((c) => c.user_id));
  const off = new Set((blocked ?? []).map((b) => b.user_id));
  const lastSeen = new Map((auth?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]));

  const users: AdminUserRow[] = (profiles ?? [])
    .map((p) => ({
      id: p.user_id,
      username: p.username ?? "(no username)",
      joined: p.created_at,
      lastActive: lastSeen.get(p.user_id) ?? null,
      applications: count.get(p.user_id) ?? 0,
      hasCv: withCv.has(p.user_id),
      disabled: off.has(p.user_id),
    }))
    .sort((a, b) => b.joined.localeCompare(a.joined));

  return (
    <AdminTabGuard>
      <header className="border-border bg-card border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <span className="font-semibold">JobBuddy admin</span>
          <form action={adminSignOut}>
            <button className="text-muted-foreground text-sm hover:underline">Leave admin</button>
          </form>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-muted-foreground text-sm">
            {users.length} user{users.length === 1 ? "" : "s"}. Disable blocks sign-in and the
            extension; Kick signs someone out everywhere; Delete removes the account and all its
            data.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DailyColumns
            title="Jobs posted (all sources)"
            series={1}
            unit="job"
            points={(activity ?? []).map((a) => ({ day: a.day, value: a.jobs_posted }))}
          />
          <DailyColumns
            title="Team applications"
            series={2}
            unit="application"
            points={(activity ?? []).map((a) => ({ day: a.day, value: a.applied }))}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DailyColumns
            title="AI answers (whole team)"
            series={1}
            unit="AI answer"
            points={aiDays.map((d) => ({ day: d.day, value: d.ok }))}
          />
          <div className="border-border bg-card flex flex-col justify-center gap-2 rounded-xl border p-4 text-sm">
            <p>
              Today: <strong>{aiDays.at(-1)?.ok ?? 0}</strong> AI answers,{" "}
              <strong>{aiDays.at(-1)?.failed ?? 0}</strong> failed attempts.
            </p>
            <p className="text-muted-foreground">
              Free limits per day, roughly: each person&apos;s Gemini key about 1,000 requests; the
              shared Groq backup about 1,000 for the whole team. An application uses about 2. Failed
              attempts are mostly a busy Gemini; the backup then answers.
            </p>
          </div>
        </div>
        <AdminUsers users={users} />
      </main>
    </AdminTabGuard>
  );
}

/** Successful and failed AI calls per UTC day (counted in the database, not downloaded). */
async function aiCallsPerDay(admin: ReturnType<typeof createAdminClient>, days: string[]) {
  const next = (day: string) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const count = async (day: string, ok: boolean) => {
    const { count } = await admin
      .from("llm_calls")
      .select("id", { count: "exact", head: true })
      .eq("ok", ok)
      .gte("created_at", `${day}T00:00:00Z`)
      .lt("created_at", `${next(day)}T00:00:00Z`);
    return count ?? 0;
  };
  return Promise.all(
    days.map(async (day) => ({
      day,
      ok: await count(day, true),
      failed: await count(day, false),
    })),
  );
}
