import { NextResponse } from "next/server";
import { z } from "zod";
import { rememberAnswers } from "@/lib/answers";
import { extensionUser, unauthorized } from "@/lib/extension/auth";

// POST { items: [{ question, answer }] }: what the user typed into form fields JobBuddy
// couldn't fill. Saved per question (newest wins) and filled by the extension next time.
// Never sent to any AI.

const body = z.object({
  items: z
    .array(
      z.object({
        question: z.string().trim().min(2).max(500),
        answer: z.string().trim().min(1).max(2000),
        /** An AI answer the user changed: goes to answer memory (reused for the same question). */
        ai: z.boolean().optional(),
      }),
    )
    .max(40),
  company: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const auth = await extensionUser(request);
  if (!auth) return unauthorized();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (parsed.data.items.length === 0) return NextResponse.json({ saved: 0 });

  const edited = parsed.data.items.filter((i) => i.ai);
  if (edited.length > 0) {
    await rememberAnswers(auth.supabase, auth.userId, parsed.data.company ?? "", edited);
  }
  const typed = parsed.data.items.filter((i) => !i.ai && i.answer.length <= 500);
  if (typed.length === 0) return NextResponse.json({ saved: edited.length });

  const { error } = await auth.supabase.from("learned_answers").upsert(
    typed.map((i) => ({
      user_id: auth.userId,
      question: i.question,
      answer: i.answer,
    })),
    { onConflict: "user_id,question" },
  );
  if (error) return NextResponse.json({ error: "Couldn't save" }, { status: 500 });
  return NextResponse.json({ saved: parsed.data.items.length });
}
