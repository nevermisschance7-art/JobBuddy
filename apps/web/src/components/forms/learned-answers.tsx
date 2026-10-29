"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/field";
import { forgetLearnedAnswer } from "@/lib/actions/account";

export type LearnedAnswer = { id: string; question: string; answer: string };

/** What the extension learned from fields the user filled in themselves. Never sent to an AI. */
export function LearnedAnswers({ items }: { items: LearnedAnswer[] }) {
  const [list, setList] = useState(items);
  const [pending, startTransition] = useTransition();
  return (
    <Card className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        When a form asks something JobBuddy couldn&apos;t fill (address line, post code, a status
        question...) and you fill it yourself, the extension remembers your answer and fills it next
        time. Kept only for you, never sent to any AI.
      </p>
      {list.length === 0 ? (
        <p className="text-muted-foreground">Nothing learned yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {list.map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.question}</p>
                <p className="text-muted-foreground break-words">{item.answer}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={`Forget: ${item.question}`}
                onClick={() =>
                  startTransition(async () => {
                    await forgetLearnedAnswer(item.id);
                    setList((l) => l.filter((x) => x.id !== item.id));
                  })
                }
              >
                <Trash2 size={14} /> Forget
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
