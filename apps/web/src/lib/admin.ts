import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

// The admin page is protected by the admin password only (ADMIN_PASSWORD on the server);
// no JobBuddy account is needed. After the right password, an httpOnly cookie made from it
// opens the page for 12 hours. Changing the password signs every admin out.

export const ADMIN_COOKIE = "jb_admin";
const COOKIE_HOURS = 12;

/** A cookie value only the server can make, tied to the current password. */
export function adminToken(): string {
  return createHmac("sha256", serverEnv("AUTH_SECRET"))
    .update(`admin:${serverEnv("ADMIN_PASSWORD")}`)
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

/** "password": show the password form. "ok": the admin page. */
export async function adminAccess(): Promise<"password" | "ok"> {
  if (!process.env.ADMIN_PASSWORD) return "password";
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value ?? "";
  const expected = adminToken();
  return cookie.length === expected.length &&
    timingSafeEqual(Buffer.from(cookie), Buffer.from(expected))
    ? "ok"
    : "password";
}
