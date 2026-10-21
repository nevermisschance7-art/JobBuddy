"use server";

import { redirect } from "next/navigation";
import { failed, saved, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/data";
import { text } from "@/lib/form";
import { createAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function saveDisplayName(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const name = text(formData, "display_name");
  if (!name || name.length > 60) return failed("Use 1 to 60 characters.");
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: name })
    .eq("user_id", user.id);
  if (error) return failed("Saving failed. Try again.");
  revalidatePath("/", "layout");
  return saved();
}

/** Deletes the account, every personal row (cascade) and every stored file. */
export async function deleteAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("user_id", user.id)
    .single();
  if (!profile?.username || text(formData, "confirm") !== profile.username) {
    return failed("Type your username exactly to confirm.");
  }

  const admin = createAdminClient();
  const { data: files } = await admin.storage.from("cvs").list(user.id, { limit: 1000 });
  if (files && files.length > 0) {
    await admin.storage.from("cvs").remove(files.map((f) => `${user.id}/${f.name}`));
  }
  // Applications block job deletion, not user deletion: they cascade with the user.
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("deleteUser failed", error.message);
    return failed("Deleting failed. Nothing was removed from your account. Try again.");
  }

  await supabase.auth.signOut();
  redirect("/login");
}
