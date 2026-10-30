import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isBlocked } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";

// The user's Gmail script calls /api/mail/* with "Authorization: Bearer <mail key>".
// Only the key's sha256 hash is stored. Routes use the admin client, so every query
// must be scoped by the userId returned here.

export const MAIL_KEY_PREFIX = "jbm_";

export const hashMailKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function mailUser(
  request: Request,
): Promise<{ admin: ReturnType<typeof createAdminClient>; userId: string } | null> {
  const key = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!key || !key.startsWith(MAIL_KEY_PREFIX) || key.length > 200) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("mail_tokens")
    .select("user_id")
    .eq("token_hash", hashMailKey(key))
    .maybeSingle();
  if (!data || (await isBlocked(data.user_id))) return null;
  await admin
    .from("mail_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("user_id", data.user_id);
  return { admin, userId: data.user_id };
}

export const mailUnauthorized = () =>
  NextResponse.json({ error: "This mail key was turned off." }, { status: 401 });
