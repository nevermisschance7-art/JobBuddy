"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { prepareCv } from "@/lib/actions/tailor";

/** "Tailor with AI" and "Use my CV as it is" for one application. */
export function TailorButtons({
  applicationId,
  tailored,
}: {
  applicationId: string;
  tailored: boolean;
}) {
  const [state, action, pending] = useActionState(prepareCv, initialState);
  const [mode, setMode] = useState<"ai" | "plain">("ai");

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="application_id" value={applicationId} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="mode"
          value="ai"
          disabled={pending}
          onClick={() => setMode("ai")}
        >
          {pending && mode === "ai"
            ? "Tailoring, about 10 seconds..."
            : tailored
              ? "Tailor again"
              : "Tailor with AI"}
        </Button>
        <Button
          type="submit"
          name="mode"
          value="plain"
          variant="outline"
          disabled={pending}
          onClick={() => setMode("plain")}
        >
          {pending && mode === "plain" ? "Making files..." : "Use my CV as it is"}
        </Button>
      </div>
      <FormMessage error={state.error} ok={state.message} />
    </form>
  );
}
