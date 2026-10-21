"use client";

import { Bookmark, BookmarkCheck, ExternalLink, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { explainMatch, prepareApplication, restoreMatch, setSaved } from "@/lib/actions/matches";
import {
  ELIGIBILITY_LABEL,
  FRESHNESS_LABEL,
  freshness,
  locationLabel,
  postedLabel,
  REMOTE_LABEL,
  salaryLabel,
  type EligibilityChip,
  type Freshness,
} from "@/lib/job-display";
import type { MatchCard } from "@/lib/matches";
import { cn } from "@/lib/utils";
import { NotForMeDialog } from "./not-for-me-dialog";
import { ScoreRing } from "./score-ring";

const FRESH_STYLE: Record<Freshness, string> = {
  new: "bg-success/15 text-success",
  recent: "bg-info/15 text-info",
  relevant: "bg-muted text-foreground",
  older: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

const ELIG_STYLE: Record<EligibilityChip, string> = {
  indicated: "bg-success/15 text-success",
  sponsorship_stated: "bg-success/15 text-success",
  unclear: "bg-warning/20 text-foreground",
  restriction: "bg-destructive/15 text-destructive",
};

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

export function JobCard({
  match,
  onGone,
}: {
  match: MatchCard;
  /** Called when the card should leave the current list (dismissed, restored, unsaved). */
  onGone: (jobId: string) => void;
}) {
  const job = match.jobs;
  const [saved, setSavedState] = useState(match.status === "saved");
  const [explanation, setExplanation] = useState(match.explanation);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const fresh = freshness(job.posted_at);
  const chip = (match.breakdown.eligibility?.chip ?? "unclear") as EligibilityChip;
  const salary = salaryLabel(job.salary_min, job.salary_max, job.salary_currency);
  const reasons = match.breakdown.top_reasons ?? [];
  const isHidden = match.status === "dismissed";

  return (
    <article className="border-border bg-card flex flex-col gap-4 rounded-xl border p-4 sm:p-5">
      <div className="flex items-start gap-4">
        <ScoreRing score={match.score} />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug">
            <a href={job.apply_url} target="_blank" rel="noreferrer" className="hover:underline">
              {job.title}
            </a>
          </h3>
          <p className="text-muted-foreground text-sm">
            {job.company_name} · {locationLabel(job)}
            {job.remote_type ? ` · ${REMOTE_LABEL[job.remote_type] ?? job.remote_type}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip className={FRESH_STYLE[fresh]}>
              {fresh === "unknown"
                ? "Date unknown"
                : `${FRESHNESS_LABEL[fresh]} · ${postedLabel(job.posted_at)}`}
            </Chip>
            <Chip className={ELIG_STYLE[chip]}>{ELIGIBILITY_LABEL[chip]}</Chip>
            {salary ? <Chip className="bg-muted">{salary}</Chip> : null}
          </div>
        </div>
      </div>

      {reasons.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {reasons.map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden className="text-success">
                ✓
              </span>
              {r}
            </li>
          ))}
          {match.breakdown.note ? (
            <li className="text-muted-foreground">{match.breakdown.note}</li>
          ) : null}
        </ul>
      ) : null}

      {explanation ? (
        <p className="bg-muted rounded-lg px-3 py-2 text-sm">{explanation}</p>
      ) : explainError ? (
        <p className="text-destructive text-sm">{explainError}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {isHidden ? (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await restoreMatch(job.id);
                onGone(job.id);
              })
            }
          >
            Show again
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => startTransition(() => prepareApplication(job.id))}
            >
              Prepare application
            </Button>
            {!explanation ? (
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await explainMatch(job.id);
                    if (res.text) setExplanation(res.text);
                    else setExplainError(res.error ?? "Something went wrong.");
                  })
                }
              >
                <Sparkles size={14} /> {pending ? "Thinking..." : "Explain match"}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={saved}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await setSaved(job.id, !saved);
                  setSavedState(!saved);
                  if (saved && match.status === "saved") onGone(job.id);
                })
              }
            >
              {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
              {saved ? "Saved" : "Save"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setDismissOpen(true)}
            >
              Not for me
            </Button>
          </>
        )}
        <a
          href={job.apply_url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground ml-auto inline-flex items-center gap-1 self-center text-sm hover:underline"
        >
          View job <ExternalLink size={13} />
        </a>
      </div>

      {dismissOpen ? (
        <NotForMeDialog
          jobId={job.id}
          company={job.company_name}
          onClose={(dismissed) => {
            setDismissOpen(false);
            if (dismissed) onGone(job.id);
          }}
        />
      ) : null}
    </article>
  );
}
