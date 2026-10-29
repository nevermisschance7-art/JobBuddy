import { NextResponse } from "next/server";
import { z } from "zod";
import { extensionUser, unauthorized } from "@/lib/extension/auth";

// POST { items: [{ question, answer }] }: what the user typed into form fields JobBuddy
// couldn't fill. Saved per question (newest wins) and filled by the extension next time.
// Never sent to any AI.

const body = z.object({
  items: z
    .array(
      z.object({
        question: z.string().trim().min(2).max(500),
        answer: z.string().trim().min(1).max(500),
      }),
    )
    .max(40),
});

export async function POST(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (parsed.data.items.length === 0) return NextResponse.json({ saved: 0 });

  const { error } = await auth.supabase.from("learned_answers").upsert(
    parsed.data.items.map((i) => ({
      user_id: auth.userId,
      question: i.question,
      answer: i.answer,
    })),
    { onConflict: "user_id,question" },
  );
  if (error) return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  return NextResponse.json({ saved: parsed.data.items.length });
}
