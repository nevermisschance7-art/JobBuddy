"use client";

import { useActionState } from "react";
import { MascotSays } from "@/components/mascot";
import { NextField } from "@/components/next-field";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { saveTone } from "@/lib/actions/onboarding";

const TONES = [
  {
    value: "kind",
    label: "Kind",
    sample: "Three new jobs fit you today. Have a look when you're ready, no rush.",
  },
  {
    value: "funny",
    label: "Funny",
    sample: "Three new jobs! The market coughed up something decent for once.",
  },
  { value: "plain", label: "Plain", sample: "3 new matching jobs." },
] as const;

export function ToneForm({ tone, next }: { tone: string; next?: string }) {
  const [state, action, pending] = useActionState(saveTone, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <NextField next={next} />
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Message tone</legend>
        {TONES.map((t) => (
          <label
            key={t.value}
            className="flex cursor-pointer flex-col gap-3 rounded-xl border border-border p-4 has-[:checked]:border-foreground"
          >
            <span className="flex items-center gap-2 font-medium">
              <input type="radio" name="tone" value={t.value} defaultChecked={tone === t.value} />
              {t.label}
            </span>
            <MascotSays mood={t.value === "plain" ? "thinking" : "happy"}>{t.sample}</MascotSays>
          </label>
        ))}
      </fieldset>
      <FormMessage error={state.error} ok={state.message} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving..." : next ? "Save and continue" : "Save tone"}
      </Button>
    </form>
  );
}
