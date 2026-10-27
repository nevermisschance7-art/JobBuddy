import { ALERT_TYPES } from "@jobbuddy/shared";
import { NextResponse } from "next/server";
import { z } from "zod";
import { extensionUser, unauthorized } from "@/lib/extension/auth";

// GET ?since=<ISO>: alert events created after `since` (for notifications) and the unread
// count (for the badge). POST { ids }: mark those events read.

export async function GET(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const { supabase, userId } = auth;

  const raw = new URL(request.url).searchParams.get("since");
  const since =
    raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : new Date(Date.now() - 3_600_000);
  const [{ data: events }, { count }] = await Promise.all([
    supabase
      .from("events")
      .select("id, type, payload, created_at")
      .eq("user_id", userId)
      .in("type", [...ALERT_TYPES])
      .eq("read", false)
      .gt("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .limit(20),
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("type", [...ALERT_TYPES])
      .eq("read", false),
  ]);
  return NextResponse.json({ events: events ?? [], unread: count ?? 0 });
}

const markRead = z.object({ ids: z.array(z.string().uuid()).max(100) });

export async function POST(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const parsed = markRead.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (parsed.data.ids.length > 0) {
    await auth.supabase
      .from("events")
      .update({ read: true })
      .eq("user_id", auth.userId)
      .in("id", parsed.data.ids);
  }
  return NextResponse.json({ ok: true });
}
