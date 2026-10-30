import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

// The admin page is protected by the admin password only (ADMIN_PASSWORD on the server);
// no JobBuddy account is needed. After the right password, an httpOnly cookie made from it
// opens the page, in that tab only: the cookie ends with the browser session, and the page
// signs out when it is opened in a tab that didn't enter the password (AdminTabGuard).
// Changing the password signs every admin out.

export const ADMIN_COOKIE = "jb_admin";

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
  sameSite: "lax" as const,
  path: "/",
  // No maxAge: a session cookie, gone when the browser closes.
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
