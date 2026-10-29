import "server-only";
import { redirect } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";

/** True when an admin disabled this account (server-only table). */
export async function isBlocked(userId: string): Promise<boolean> {
  const { count } = await createAdminClient()
    .from("blocked_users")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}

/**
 * The signed-in user and an RLS-scoped client. Redirects to /login when signed out, and
 * signs out an account an admin disabled (its session may still be valid for up to an hour).
 */
export async function requireUser() {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  if (await isBlocked(user.id)) {
    await supabase.auth.signOut();
    redirect("/login?disabled=1");
  }
  return { supabase, user };
}

export async function loadProfile() {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();
  return { supabase, user, profile };
}
