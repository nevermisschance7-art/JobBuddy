import { createHmac } from "node:crypto";

// Username-only sign-in. Supabase Auth needs an email and password, so both are derived
// from the username on the server. No email is ever sent to these addresses.

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,29}$/;
const EMAIL_DOMAIN = "users.jobbuddy.invalid";

export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function usernameError(username: string): string | null {
  if (username.length < 3) return "Use at least 3 characters.";
  if (username.length > 30) return "Use at most 30 characters.";
  if (!USERNAME_PATTERN.test(username)) {
    return "Use letters, numbers, - and _ only, starting with a letter or number.";
  }
  return null;
}

export function usernameToEmail(username: string): string {
  return `${username}@${EMAIL_DOMAIN}`;
}

export function derivePassword(username: string, secret: string): string {
  return createHmac("sha256", secret).update(`login:${username}`).digest("base64url");
}
