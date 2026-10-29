"use client";

import { countWords } from "@jobbuddy/shared";
import { Copy, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { draftApplicationAnswers, saveApplicationAnswers } from "@/lib/actions/answers";
import type { StoredAnswer } from "@/lib/answers-core";

const LABELS: Record<StoredAnswer["kind"], { text: string; tone: string; help?: string }> = {
  fixed: {
    text: "Your fixed answer",
    tone: "bg-emerald-100 text-emerald-900",
    help: "From your fixed answers. No AI involved.",
  },
  missing_fixed: {
    text: "Needs your fixed answer",
    tone: "bg-amber-100 text-amber-900",
    help: "A sensitive question: an AI never answers these. Type your answer once; I'll reuse it on every form.",
  },
  reused: { text: "Reused, check this", tone: "bg-sky-100 text-sky-900" },
  drafted: { text: "Drafted by AI", tone: "bg-violet-100 text-violet-900" },
  failed: {
    text: "Write this one yourself",
    tone: "bg-rose-100 text-rose-900",
    help: "The AI didn't answer: it may be busy (Google's free Gemini is sometimes overloaded) or no AI key is set up. Press Draft answers again in a minute, or write it yourself.",
  },
};

export function AnswersPanel({
  applicationId,
  answers,
}: {
  applicationId: string;
  answers: StoredAnswer[];
}) {
  const [draftState, draftAction, drafting] = useActionState(draftApplicationAnswers, initialState);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <form action={draftAction} className="flex flex-col gap-3">
          <input type="hidden" name="application_id" value={applicationId} />
          <Field
            label="Paste the questions, one per line"
            htmlFor="questions"
            hint='Limits like "(max 100 words)" are respected. Without one, answers stay under 80 words.'
          >
            <Textarea
              id="questions"
              name="questions"
              className="min-h-28"
              placeholder={"Why do you want to work here?\nDo you need visa sponsorship?"}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="cover_letter" /> The form asks for a cover letter (up to
            180 words)
          </label>
          <FormMessage error={draftState.error} ok={draftState.message} />
          <Button type="submit" variant="outline" disabled={drafting} className="self-start">
            {drafting ? "Writing answers..." : "Draft answers"}
          </Button>
        </form>
      </div>

      {/* Starts fresh when new drafts arrive; the draft form above keeps its message. */}
      <AnswersList
        key={answers.map((a) => `${a.kind}:${a.question}`).join("|")}
        applicationId={applicationId}
        answers={answers}
      />
    </div>
  );
}

function AnswersList({
  applicationId,
  answers,
}: {
  applicationId: string;
  answers: StoredAnswer[];
}) {
  const [saveState, saveAction, saving] = useActionState(saveApplicationAnswers, initialState);
  const [items, setItems] = useState(() =>
    answers.map((a) => ({ ...a, final: a.final ?? a.answer })),
  );

  const setFinal = (i: number, final: string) =>
    setItems((list) => list.map((a, j) => (j === i ? { ...a, final } : a)));

  return items.length > 0 ? (
    <form action={saveAction} className="flex flex-col gap-4">
      <input type="hidden" name="application_id" value={applicationId} />
      <input
        type="hidden"
        name="finals"
        value={JSON.stringify(items.map((a) => ({ question: a.question, final: a.final })))}
      />
      {items.map((a, i) => {
        const label = LABELS[a.kind];
        const words = countWords(a.final);
        const id = `answer-${i}`;
        return (
          <Card key={a.question} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor={id} className="font-medium">
                {a.question}
              </label>
              <span className={`rounded-full px-2 py-0.5 text-xs ${label.tone}`}>{label.text}</span>
            </div>
            {label.help ? <p className="text-muted-foreground text-xs">{label.help}</p> : null}
            {a.unsupported?.length ? (
              <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                Check this: it mentions {a.unsupported.join(", ")}, which isn&apos;t in your CV.
                Change it or remove it unless it&apos;s true.
              </p>
            ) : null}
            {a.kind === "reused" && a.reusedFrom ? (
              <p className="text-muted-foreground text-xs">
                From your answer to: &quot;{a.reusedFrom}&quot;
              </p>
            ) : null}
            {a.kind === "fixed" || a.kind === "missing_fixed" ? (
              <Input
                id={id}
                value={a.final}
                maxLength={500}
                onChange={(e) => setFinal(i, e.target.value)}
              />
            ) : (
              <Textarea
                id={id}
                value={a.final}
                className="min-h-28"
                onChange={(e) => setFinal(i, e.target.value)}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span
                className={
                  words > a.maxWords ? "font-medium text-rose-700" : "text-muted-foreground"
                }
              >
                {words} / {a.maxWords} words
                {words > a.maxWords ? ", too long for this form" : ""}
              </span>
              <span className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => navigator.clipboard?.writeText(a.final)}
                >
                  <Copy size={14} /> Copy
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setItems((list) => list.filter((_, j) => j !== i))}
                >
                  <Trash2 size={14} /> Remove
                </Button>
              </span>
            </div>
          </Card>
        );
      })}
      <FormMessage error={saveState.error} ok={saveState.message} />
      <Button type="submit" disabled={saving} className="self-start">
        {saving ? "Saving..." : "Save my answers"}
      </Button>
    </form>
  ) : null;
}
