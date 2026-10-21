"use client";

import { useActionState } from "react";
import { NextField } from "@/components/next-field";
import { Button } from "@/components/ui/button";
import { Card, Field, FormMessage, Input, Select } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { saveFixedAnswers } from "@/lib/actions/onboarding";
import { FIXED_ANSWER_KEYS } from "@/lib/fixed-answers";

export function FixedAnswersForm({
  values,
  next,
}: {
  values: Record<string, string>;
  next?: string;
}) {
  const [state, action, pending] = useActionState(saveFixedAnswers, initialState);

  return (
    <form action={action} className="flex flex-col gap-6">
      <NextField next={next} />
      <Card className="grid gap-5 sm:grid-cols-2">
        {FIXED_ANSWER_KEYS.map((q) => (
          <Field key={q.key} label={q.label} hint={q.hint} htmlFor={`fa-${q.key}`}>
            {q.kind === "choice" ? (
              <Select id={`fa-${q.key}`} name={q.key} defaultValue={values[q.key] ?? ""}>
                <option value="">Not set</option>
                {q.choices?.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={`fa-${q.key}`}
                name={q.key}
                type={q.kind === "url" ? "url" : "text"}
                maxLength={500}
                defaultValue={values[q.key] ?? ""}
              />
            )}
          </Field>
        ))}
      </Card>
      <FormMessage error={state.error} ok={state.message} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving..." : next ? "Save and continue" : "Save answers"}
      </Button>
    </form>
  );
}
