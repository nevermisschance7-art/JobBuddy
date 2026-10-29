import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { AdminPassword, AdminUsers, type AdminUserRow } from "@/components/admin/admin-users";
import { adminAccess } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/server";

export const metadata = { title: "Admin · JobBuddy" };

// Users, their application counts and uploaded CV, with Disable / Enable / Kick / Delete.
export default async function AdminPage() {
  const access = await adminAccess();
  if (access.state === "not_admin") notFound();

  if (access.state === "password") {
    return (
      <>
        <AppHeader username={access.username} />
        <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <AdminPassword />
        </main>
      </>
    );
  }

  const admin = createAdminClient();
  const [{ data: auth }, { data: profiles }, { data: apps }, { data: cvs }, { data: blocked }] =
    await Promise.all([
      admin.auth.admin.listUsers({ perPage: 1000 }),
      admin.from("profiles").select("user_id, username, created_at"),
      admin.from("applications").select("user_id"),
      admin.from("cvs").select("user_id, original_file").not("original_file", "is", null),
      admin.from("blocked_users").select("user_id"),
    ]);

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
    <>
      <AppHeader username={access.username} />
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-muted-foreground text-sm">
            {users.length} user{users.length === 1 ? "" : "s"}. Disable blocks sign-in and the
            extension; Kick signs someone out everywhere; Delete removes the account and all its
            data.
          </p>
        </div>
        <AdminUsers users={users} selfId={access.user.id} />
      </main>
    </>
  );
}
