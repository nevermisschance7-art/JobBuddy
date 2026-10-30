"use server";

import { randomBytes } from "node:crypto";
import { buildMailScript } from "@jobbuddy/shared";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireUser } from "@/lib/data";
import { MAIL_KEY_PREFIX, hashMailKey } from "@/lib/mail/auth";
import { createAdminClient } from "@/lib/supabase/server";

export type MailKeyResult =
  { ok: true; key: string; script: string } | { ok: false; error: string };

/**
 * Settings: makes a new mail key (replacing any old one, whose script then stops) and returns
 * it once, inside the Gmail script. Only the key's hash is stored.
 */
export async function createMailKey(): Promise<MailKeyResult> {
  const { user } = await requireUser();
  const key = `${MAIL_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const { error } = await createAdminClient()
    .from("mail_tokens")
    .upsert(
      {
        user_id: user.id,
        token_hash: hashMailKey(key),
        created_at: new Date().toISOString(),
        last_used_at: null,
      },
      { onConflict: "user_id" },
    );
  if (error) return { ok: false, error: "Couldn't make a key. Try again." };

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  revalidatePath("/settings");
  return { ok: true, key, script: buildMailScript({ appUrl: `${proto}://${host}`, token: key }) };
}

/** Settings: deletes the mail key. The script gets "turned off" on its next run and stops. */
export async function turnOffMail(): Promise<void> {
  const { supabase, user } = await requireUser();
  await supabase.from("mail_tokens").delete().eq("user_id", user.id);
  revalidatePath("/settings");
}
