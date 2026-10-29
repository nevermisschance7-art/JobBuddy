"use server";

import { redirect } from "next/navigation";
import { failed, type ActionState } from "@/lib/action-state";
import { serverEnv } from "@/lib/env";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { derivePassword, normaliseUsername, usernameError, usernameToEmail } from "@/lib/username";

export async function signInWithUsername(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const username = normaliseUsername(String(formData.get("username") ?? ""));
  const problem = usernameError(username);
  if (problem) return failed(problem);

  const email = usernameToEmail(username);
  const password = derivePassword(username, serverEnv("AUTH_SECRET"));
  const supabase = await createClient();

  let { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error?.code === "invalid_credentials") {
    // New username: create the account, then sign in.
    const admin = createAdminClient();
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    });
    // email_exists: someone created it a moment ago (double click); just sign in.
    if (created.error && created.error.code !== "email_exists") {
      console.error("createUser failed", created.error.message);
      return failed("Could not create your account. Try again in a minute.");
    }
    ({ error } = await supabase.auth.signInWithPassword({ email, password }));
  }

  if (error?.code === "user_banned") {
    return failed("This account is disabled. Ask your team admin.");
  }
  if (error) {
    console.error("signIn failed", error.message);
    return failed("Could not sign you in. Try again in a minute.");
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
