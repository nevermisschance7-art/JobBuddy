import { isGoodNews, statusAfterMail, type MailClass } from "@jobbuddy/shared";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { mailUnauthorized, mailUser } from "@/lib/mail/auth";

// POST { items }: employer replies the Gmail script found (good news, rejections, receipts).
// Never whole mails: sender domain, subject, a 300 character snippet and a Gmail link.
// Each message is stored once (by Gmail link); new ones move their application forward and
// good news becomes a "good_news" alert.

const cut = (n: number) => z.string().transform((s) => s.slice(0, n));

const item = z.object({
  applicationId: z.string().uuid().nullable(),
  company: cut(200),
  fromDomain: z.string().trim().min(1).max(255),
  subject: cut(300),
  snippet: cut(300),
  receivedAt: z.string().datetime({ offset: true }),
  classification: z.enum([
    "interview",
    "assessment",
    "offer",
    "next_step",
    "rejection",
    "received",
  ]),
  gmailUrl: z
    .string()
    .max(300)
    .refine((u) => u.startsWith("https://mail.google.com/")),
});
const body = z.object({ items: z.array(item).max(100) });

export async function POST(request: Request) {
  const auth = await mailUser(request);
  if (!auth) return mailUnauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { admin, userId } = auth;
  const items = [...parsed.data.items].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  if (items.length === 0) return NextResponse.json({ saved: 0 });

  // Only the user's own applications.
  const ids = [...new Set(items.map((i) => i.applicationId).filter((id): id is string => !!id))];
  const { data: apps } = ids.length
    ? await admin
        .from("applications")
        .select("id, job_id, status, applied_at, last_reply_at")
        .eq("user_id", userId)
        .in("id", ids)
    : { data: [] };
  const byId = new Map((apps ?? []).map((a) => [a.id, { ...a }]));

  const { data: inserted, error } = await admin
    .from("employer_messages")
    .upsert(
      items.map((i) => ({
        user_id: userId,
        application_id: i.applicationId && byId.has(i.applicationId) ? i.applicationId : null,
        company: i.company || null,
        from_domain: i.fromDomain,
        subject: i.subject || null,
        snippet: i.snippet || null,
        received_at: i.receivedAt,
        classification: i.classification,
        gmail_url: i.gmailUrl,
      })),
      { onConflict: "user_id,gmail_url", ignoreDuplicates: true },
    )
    .select("gmail_url");
  if (error) return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  const fresh = new Set((inserted ?? []).map((r) => r.gmail_url));

  const changed = new Set<string>();
  const events: { user_id: string; type: string; payload: Record<string, string | null> }[] = [];
  for (const i of items) {
    if (!fresh.has(i.gmailUrl)) continue;
    const app = i.applicationId ? byId.get(i.applicationId) : undefined;
    if (app) {
      const next = statusAfterMail(app.status, i.classification as MailClass);
      if (next) {
        app.status = next;
        app.applied_at ??= i.receivedAt;
        changed.add(app.id);
      }
      if (
        i.classification !== "received" &&
        (!app.last_reply_at || app.last_reply_at < i.receivedAt)
      ) {
        app.last_reply_at = i.receivedAt;
        changed.add(app.id);
      }
    }
    if (isGoodNews(i.classification)) {
      events.push({
        user_id: userId,
        type: "good_news",
        payload: {
          company: i.company,
          subject: i.subject,
          classification: i.classification,
          gmail_url: i.gmailUrl,
          application_id: app?.id ?? null,
        },
      });
    }
  }

  for (const id of changed) {
    const app = byId.get(id)!;
    await admin
      .from("applications")
      .update({ status: app.status, applied_at: app.applied_at, last_reply_at: app.last_reply_at })
      .eq("id", id)
      .eq("user_id", userId);
    if (app.status !== "prepared") {
      await admin
        .from("user_job_matches")
        .update({ status: "applied" })
        .eq("user_id", userId)
        .eq("job_id", app.job_id);
    }
  }
  if (events.length) await admin.from("events").insert(events);
  if (changed.size) revalidatePath("/applications");

  return NextResponse.json({ saved: fresh.size });
}
