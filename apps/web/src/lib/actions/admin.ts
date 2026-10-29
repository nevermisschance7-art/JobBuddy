"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { failed, type ActionState } from "@/lib/action-state";
import {
  ADMIN_COOKIE,
  adminAccess,
  adminCookieOptions,
  adminToken,
  passwordMatches,
} from "@/lib/admin";
import { text } from "@/lib/form";
import { createAdminClient } from "@/lib/supabase/server";

/** The admin password form. */
export async function adminSignIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!process.env.ADMIN_PASSWORD) return failed("The admin password isn't set on the server.");
  // A small delay makes guessing slow.
  await new Promise((r) => setTimeout(r, 800));
  if (!passwordMatches(text(formData, "password") ?? "")) return failed("Wrong password.");
  (await cookies()).set(ADMIN_COOKIE, adminToken(), adminCookieOptions);
  revalidatePath("/admin");
  return { ok: true };
}

/** Leaves the admin page on this browser. */
export async function adminSignOut(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
  revalidatePath("/admin");
}

export type AdminAction = "disable" | "enable" | "kick" | "delete";

/** Disable / enable an account, sign it out everywhere, or delete it with all its data. */
export async function adminUserAction(userId: string, action: AdminAction): Promise<string> {
  if ((await adminAccess()) !== "ok") return "Not allowed.";
  const admin = createAdminClient();

  switch (action) {
    case "disable": {
      // Blocked here (checked on every page and extension request) and banned in Auth
      // (sign-in and session refresh refused).
      await admin.from("blocked_users").upsert({ user_id: userId });
      const { error } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: "876000h",
      });
      if (error) return `Couldn't disable: ${error.message}`;
      break;
    }
    case "enable": {
      await admin.from("blocked_users").delete().eq("user_id", userId);
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
      if (error) return `Couldn't enable: ${error.message}`;
      break;
    }
    case "kick": {
      // A one-minute ban ends every session; they can sign in again afterwards.
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "1m" });
      if (error) return `Couldn't sign them out: ${error.message}`;
      break;
    }
    case "delete": {
      const { data: files } = await admin.storage.from("cvs").list(userId, { limit: 1000 });
      if (files && files.length > 0) {
        await admin.storage.from("cvs").remove(files.map((f) => `${userId}/${f.name}`));
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return `Couldn't delete: ${error.message}`;
      break;
    }
  }
  revalidatePath("/admin");
  return "Done.";
}
