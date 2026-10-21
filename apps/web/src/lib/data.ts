import "server-only";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";

/** The signed-in user and an RLS-scoped client. Redirects to /login when signed out. */
export async function requireUser() {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
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
