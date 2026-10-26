"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { rereadCv, uploadCv } from "@/lib/actions/onboarding";

export function CvUpload({ hasCv }: { hasCv: boolean }) {
  const [state, action, pending] = useActionState(uploadCv, initialState);

  return (
    <form action={action} className="flex flex-col gap-3">
      <Input
        type="file"
        name="cv"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        required
        className="h-auto py-2"
        aria-label="CV file"
      />
      <p className="text-muted-foreground text-xs">PDF or Word (.docx), up to 5 MB.</p>
      <FormMessage error={state.error} ok={state.message} />
      <Button
        type="submit"
        variant={hasCv ? "outline" : "default"}
        disabled={pending}
        className="self-start"
      >
        {pending ? "Reading your CV..." : hasCv ? "Upload a new version" : "Upload CV"}
      </Button>
    </form>
  );
}

/** Re-reads the saved CV file with AI. Useful when the first read missed things. */
export function RereadCv({ cvId }: { cvId: string }) {
  const [state, action, pending] = useActionState(rereadCv, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="cv_id" value={cvId} />
      <p className="text-muted-foreground text-sm">
        Fields missing? Let the AI read your saved CV again and fill them in.
      </p>
      <FormMessage error={state.error} ok={state.message} />
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        {pending ? "Reading your CV..." : "Fill from my CV again"}
      </Button>
    </form>
  );
}
