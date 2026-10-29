import "server-only";
import type { Database } from "@jobbuddy/shared";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isBlocked } from "@/lib/data";
import { publicEnv } from "@/lib/env";
import type { createClient } from "@/lib/supabase/server";

// The Chrome extension calls /api/extension/* with "Authorization: Bearer <access token>".
// Requests then run as that user, so RLS applies exactly as on the website.

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A Supabase client acting as the session's user (no cookies needed). */
export function clientForToken(token: string): Supabase {
  return createSupabaseClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as unknown as Supabase;
}

export async function extensionUser(
  request: Request,
): Promise<{ supabase: Supabase; userId: string } | null> {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const supabase = clientForToken(token);
  const { data } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (!userId || (await isBlocked(userId))) return null;
  return { supabase, userId };
}

export const unauthorized = () =>
  NextResponse.json({ error: "Sign in again in the extension." }, { status: 401 });
