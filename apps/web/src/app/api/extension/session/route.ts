import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { publicEnv, serverEnv } from "@/lib/env";
import { derivePassword, normaliseUsername, usernameError, usernameToEmail } from "@/lib/username";

// Extension sign-in, the same as the website's: username only. Existing accounts only;
// new users sign up on the website first. Also refreshes a session ({ refresh_token }).

const body = z.union([
  z.object({ username: z.string().max(60) }),
  z.object({ refresh_token: z.string().min(10).max(2000) }),
]);

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const supabase = createSupabaseClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if ("refresh_token" in parsed.data) {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: parsed.data.refresh_token,
    });
    if (error || !data.session) {
      return NextResponse.json({ error: "Sign in again in the extension." }, { status: 401 });
    }
    return NextResponse.json(sessionJson(data.session));
  }

  const username = normaliseUsername(parsed.data.username);
  const problem = usernameError(username);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password: derivePassword(username, serverEnv("AUTH_SECRET")),
  });
  if (error?.code === "user_banned") {
    return NextResponse.json(
      { error: "This account is disabled. Ask your team admin." },
      { status: 403 },
    );
  }
  if (error || !data.session) {
    const status = error?.code === "invalid_credentials" ? 404 : 502;
    return NextResponse.json(
      {
        error:
          status === 404
            ? "No account with that username. Sign up on the website first."
            : "Could not sign you in. Try again in a minute.",
      },
      { status },
    );
  }
  return NextResponse.json({ ...sessionJson(data.session), username });
}

function sessionJson(s: { access_token: string; refresh_token: string; expires_at?: number }) {
  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  };
}
