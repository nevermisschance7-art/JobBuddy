import { NextResponse } from "next/server";
import { extensionUser, unauthorized } from "@/lib/extension/auth";

// Popup data: today's matches, what to do next, and the alert settings for the background poll.

export async function GET(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const { supabase, userId } = auth;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, tone, time_zone, alert_settings, min_score")
    .eq("user_id", userId)
    .single();
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [{ count: newMatches }, { count: toReview }] = await Promise.all([
    supabase
      .from("user_job_matches")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("passed_filters", true)
      .gte("score", profile?.min_score ?? 55)
      .gte("created_at", since),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "prepared"),
  ]);

  return NextResponse.json({
    username: profile?.username ?? null,
    tone: profile?.tone ?? "kind",
    timeZone: profile?.time_zone ?? "UTC",
    alertSettings: profile?.alert_settings ?? {},
    newMatches: newMatches ?? 0,
    toReview: toReview ?? 0,
  });
}
