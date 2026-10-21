"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { dismissMatch } from "@/lib/actions/matches";
import { DISMISS_REASONS, type DismissReason } from "@/lib/dismiss";

// Filter hints for reasons a filter change would fix for good.
const HINTS: Partial<Record<DismissReason, string>> = {
  location: "Tip: adjust your countries or work style in your filters.",
  level: "Tip: set the seniority levels you want in your filters.",
  tech: "Tip: add skills to skip, or must-have skills, in your filters.",
  pay: "Tip: set a salary floor in your filters.",
};

export function NotForMeDialog({
  jobId,
  company,
  onClose,
}: {
  jobId: string;
  company: string;
  onClose: (dismissed: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<DismissReason | null>(null);
  const [note, setNote] = useState("");
  const [skipCompany, setSkipCompany] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const hint = reason ? HINTS[reason] : null;

  return (
    <dialog
      ref={ref}
      onClose={() => onClose(false)}
      className="border-border bg-card text-card-foreground m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border p-5 backdrop:bg-black/40"
    >
      <h2 className="mb-1 text-lg font-semibold">Not for me</h2>
      <p className="text-muted-foreground mb-4 text-sm">Optional: tell me why, so I get better.</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(DISMISS_REASONS) as DismissReason[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={reason === key}
            onClick={() => setReason(reason === key ? null : key)}
            className="border-border aria-pressed:border-foreground aria-pressed:bg-muted rounded-full border px-3 py-1 text-sm"
          >
            {DISMISS_REASONS[key]}
          </button>
        ))}
      </div>
      {reason === "other" ? (
        <Input
          aria-label="Reason"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What was off?"
          className="mb-4"
        />
      ) : null}
      {reason === "company" ? (
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={skipCompany}
            onChange={(e) => setSkipCompany(e.target.checked)}
          />
          Skip all jobs from {company} from now on
        </label>
      ) : null}
      {hint ? (
        <p className="text-muted-foreground mb-4 text-sm">
          {hint}{" "}
          <Link href="/settings#filters" className="underline">
            Open filters
          </Link>
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => ref.current?.close()}>
          Cancel
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await dismissMatch(jobId, reason, note, skipCompany ? company : null);
              onClose(true);
            })
          }
        >
          Hide this job
        </Button>
      </div>
    </dialog>
  );
}
