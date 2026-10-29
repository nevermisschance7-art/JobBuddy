import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/data";
import { serverEnv } from "@/lib/env";

// The admin page needs two things: being signed in as an admin username (ADMIN_USERNAMES,
// default "never-miss") AND the admin password (ADMIN_PASSWORD). Sign-in is username-only,
// so the password is what actually protects it.

export const ADMIN_COOKIE = "jb_admin";
const COOKIE_HOURS = 12;

export function adminUsernames(): string[] {
  return (process.env.ADMIN_USERNAMES ?? "never-miss")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
}

/** A cookie value only the server can make: tied to the user and the current password. */
export function adminToken(userId: string): string {
  return createHmac("sha256", serverEnv("AUTH_SECRET"))
    .update(`admin:${userId}:${serverEnv("ADMIN_PASSWORD")}`)
    .digest("base64url");
}

export function passwordMatches(given: string): boolean {
  const expected = Buffer.from(serverEnv("ADMIN_PASSWORD"));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const adminCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
  maxAge: COOKIE_HOURS * 3600,
};

/**
 * "not_admin": not an admin username (the page pretends not to exist).
 * "password": an admin, but the password hasn't been entered yet.
 * "ok": allowed.
 */
export async function adminAccess() {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("user_id", user.id)
    .single();
  const username = profile?.username ?? "";
  if (!adminUsernames().includes(username) || !process.env.ADMIN_PASSWORD) {
    return { state: "not_admin" as const, user, username };
  }
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  const expected = adminToken(user.id);
  const ok =
    cookie.length === expected.length &&
    timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
  return { state: ok ? ("ok" as const) : ("password" as const), user, username };
}
