// Env access. Server-only values throw when missing so misconfiguration fails loudly.

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

export function serverEnv(
  name: "SUPABASE_SERVICE_ROLE_KEY" | "APP_ENCRYPTION_KEY" | "AUTH_SECRET",
): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env variable ${name}`);
  return value;
}
