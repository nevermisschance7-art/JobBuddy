"use client";

import { Bookmark, BookmarkCheck, Check, ExternalLink, Sparkles, X, Zap } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { explainMatch } from "@/lib/actions/matches";
import {
  ELIGIBILITY_LABEL,
  locationLabel,
  postedLabel,
  salaryLabel,
  type EligibilityChip,
} from "@/lib/job-display";
import type { MatchCard } from "@/lib/matches";
import { cn } from "@/lib/utils";
import { CompanyMark, TechChips, type JobActions, type JobState } from "./job-item";
import { ScoreRing } from "./score-ring";

/** What the matcher saves about tech fit (older rows only have points and reason). */
type TechDetail = {
  points?: number;
  reason?: string;
  technologies?: number;
  stack?: number;
  role?: number;
  have?: string[];
  missing?: string[];
  lowered?: string[];
};

const ELIG_STYLE: Record<EligibilityChip, string> = {
  indicated: "bg-success/15 text-success",
  sponsorship_stated: "bg-success/15 text-success",
  unclear: "bg-warning/20 text-foreground",
  restriction: "bg-destructive/15 text-destructive",
};

const SOURCE_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workable: "Workable",
  smartrecruiters: "SmartRecruiters", teamtailor: "Teamtailor", workday: "Workday",
  personio: "Personio", recruitee: "Recruitee", weworkremotely: "We Work Remotely",
  hackernews: "Hacker News", adzuna: "Adzuna", reed: "Reed", jooble: "Jooble",
  remotive: "Remotive", himalayas: "Himalayas", arbeitnow: "Arbeitnow", jobicy: "Jobicy",
}; // prettier-ignore

function Part({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <b className="font-mono text-[12.5px] tabular-nums">
        {Math.round(value)} / {max}
      </b>
      <div className="bg-muted col-span-2 h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function JobDrawer({
  match,
  tab,
  onTab,
  onClose,
  state,
  skills,
  actions,
  hiddenView,
}: {
  match: MatchCard;
  tab: "fit" | "description";
  onTab: (tab: "fit" | "description") => void;
  onClose: () => void;
  state: JobState;
  skills: { mine: string[]; other: string[] };
  actions: JobActions;
  hiddenView: boolean;
}) {
  const job = match.jobs;
  const tech = (match.breakdown.technical ?? {}) as TechDetail;
  const chip = (match.breakdown.eligibility?.chip ?? "unclear") as EligibilityChip;
  const salary = salaryLabel(job.salary_min, job.salary_max, job.salary_currency);
  // The tech fit sentence is already at the top of the panel: not again in this list.
  const reasons = (match.breakdown.top_reasons ?? []).filter((r) => r !== tech.reason);
  const [explanation, setExplanation] = useState(match.explanation);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [thinking, startThinking] = useTransition();
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setExplanation(match.explanation);
    setExplainError(null);
    close.current?.focus();
  }, [match.id, match.explanation]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const have = tech.have ?? skills.mine;
  const missing = tech.missing ?? skills.other;
  const hasParts = typeof tech.technologies === "number";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={job.title}
        className="bg-card border-border animate-in slide-in-from-right-6 fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[560px] flex-col border-l shadow-2xl"
      >
        <div className="border-border flex flex-col gap-3 border-b px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <ScoreRing score={match.score} size={48} />
            <div className="min-w-0 flex-1">
              <h2 className="text-balance text-lg font-semibold leading-snug">{job.title}</h2>
              <p className="text-muted-foreground mt-0.5 flex items-center gap-2 text-sm">
                <CompanyMark name={job.company_name} size={18} />
                <span>
                  {job.company_name} · {locationLabel(job)} · {postedLabel(job.posted_at)}
                </span>
              </p>
            </div>
            <button
              ref={close}
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="text-muted-foreground hover:bg-muted hover:text-foreground grid h-8 w-8 shrink-0 place-items-center rounded-md"
            >
              <X size={18} />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {hiddenView ? (
              <Button size="sm" variant="outline" onClick={() => actions.restore(job.id)}>
                Show again
              </Button>
            ) : (
              <Button
                size="sm"
                className="font-semibold"
                disabled={state.applying || Boolean(state.applied)}
                onClick={() => actions.quickApply(match)}
              >
                <Zap size={14} /> {state.applying ? "Tailoring CV..." : "Quick apply"}
              </Button>
            )}
            <a
              href={job.apply_url}
              target="_blank"
              rel="noreferrer"
              onClick={() => actions.posting(job.id)}
              className="border-border bg-card hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium"
            >
              Open job posting <ExternalLink size={13} />
            </a>
            {!hiddenView ? (
              <Button size="sm" variant="outline" onClick={() => actions.toggleSave(match)}>
                {state.saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                {state.saved ? "Saved" : "Save"}
              </Button>
            ) : null}
          </div>
          {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
        </div>

        <div role="tablist" className="border-border flex gap-5 border-b px-5">
          {(
            [
              ["fit", "Why it fits"],
              ["description", "Full description"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => onTab(key)}
              className={cn(
                "-mb-px border-b-2 py-2.5 text-sm font-medium",
                tab === key
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 pb-8 pt-4">
          {tab === "fit" ? (
            <>
              {tech.reason ? (
                <p className="bg-brand-soft rounded-xl px-3.5 py-3 text-sm leading-relaxed">
                  {tech.reason}.
                </p>
              ) : null}

              {hasParts ? (
                <section className="flex flex-col gap-2.5">
                  <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                    Tech fit {match.score} / 100
                  </h3>
                  <Part label="Technologies you have" value={tech.technologies ?? 0} max={60} />
                  <Part label="Your main stack in the job" value={tech.stack ?? 0} max={25} />
                  <Part label="Same kind of role" value={tech.role ?? 0} max={15} />
                  {tech.lowered && tech.lowered.length > 0 ? (
                    <ul className="text-muted-foreground mt-1 list-disc pl-5 text-[13px]">
                      {tech.lowered.map((l) => (
                        <li key={l}>Lowered: {l}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}

              <section className="flex flex-col gap-2">
                <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                  Technologies (yours in green)
                </h3>
                <TechChips mine={have} other={missing} />
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                  Good to know
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium",
                      ELIG_STYLE[chip],
                    )}
                  >
                    {ELIGIBILITY_LABEL[chip]}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[13px]">
                  <div className="bg-muted/60 rounded-lg px-3 py-2">
                    <small className="text-muted-foreground block text-[11.5px]">Location</small>
                    {locationLabel(job)}
                  </div>
                  <div className="bg-muted/60 rounded-lg px-3 py-2">
                    <small className="text-muted-foreground block text-[11.5px]">Salary</small>
                    {salary ?? "Not stated"}
                  </div>
                  <div className="bg-muted/60 rounded-lg px-3 py-2">
                    <small className="text-muted-foreground block text-[11.5px]">Posted</small>
                    {postedLabel(job.posted_at).replace(/^Posted /, "")}
                  </div>
                  <div className="bg-muted/60 rounded-lg px-3 py-2">
                    <small className="text-muted-foreground block text-[11.5px]">Found on</small>
                    {SOURCE_LABEL[job.source] ?? job.source}
                  </div>
                </div>
                {reasons.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-1 text-[13px]">
                    {reasons.map((r) => (
                      <li key={r} className="flex gap-2">
                        <Check size={14} className="text-success mt-0.5 shrink-0" />
                        {r}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                  In plain words
                </h3>
                {explanation ? (
                  <p className="text-sm leading-relaxed">{explanation}</p>
                ) : (
                  <div className="flex flex-col items-start gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={thinking}
                      onClick={() =>
                        startThinking(async () => {
                          const res = await explainMatch(job.id);
                          if (res.text) setExplanation(res.text);
                          else setExplainError(res.error ?? "Something went wrong.");
                        })
                      }
                    >
                      <Sparkles size={14} /> {thinking ? "Thinking..." : "Explain with AI"}
                    </Button>
                    {explainError ? (
                      <p className="text-destructive text-sm">{explainError}</p>
                    ) : null}
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="whitespace-pre-line text-[14px] leading-relaxed">
              {job.description_text?.trim() || "This job has no description."}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
