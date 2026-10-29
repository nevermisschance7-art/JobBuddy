"use client";

import { termsIn } from "@jobbuddy/shared";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  MoreHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { moveApplication } from "@/lib/actions/applications";
import { explainMatch, restoreMatch, setSaved } from "@/lib/actions/matches";
import { quickApply } from "@/lib/actions/quick-apply";
import {
  ELIGIBILITY_LABEL,
  locationLabel,
  postedLabel,
  salaryLabel,
  type EligibilityChip,
} from "@/lib/job-display";
import type { AppliedBefore } from "@/lib/company";
import type { MatchCard } from "@/lib/matches";
import { cn } from "@/lib/utils";
import { NotForMeDialog } from "./not-for-me-dialog";
import { ScoreRing } from "./score-ring";

const ELIG_STYLE: Record<EligibilityChip, string> = {
  indicated: "bg-success/15 text-success",
  sponsorship_stated: "bg-success/15 text-success",
  unclear: "bg-warning/20 text-foreground",
  restriction: "bg-destructive/15 text-destructive",
};

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
  smartrecruiters: "SmartRecruiters",
  teamtailor: "Teamtailor",
  workday: "Workday",
  personio: "Personio",
  recruitee: "Recruitee",
  weworkremotely: "We Work Remotely",
  hackernews: "Hacker News",
};

const appliedOn = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

type Applied = { applicationId: string; note?: string; done?: boolean };

export function JobCard({
  match,
  userTerms,
  appliedBefore,
  onGone,
  onSeen,
}: {
  match: MatchCard;
  /** The user applied to this company in the last 30 days. */
  appliedBefore?: AppliedBefore;
  /** Technologies in the user's CV (canonical, lower case), to highlight on the card. */
  userTerms: Set<string>;
  /** Called when the card should leave the current list (dismissed, restored, unsaved, applied). */
  onGone: (jobId: string) => void;
  /** The user opened this job: no longer "New". */
  onSeen: (jobId: string) => void;
}) {
  const job = match.jobs;
  const [isNew, setIsNew] = useState(match.status === "new");
  const [open, setOpen] = useState(false);
  const [saved, setSavedState] = useState(match.status === "saved");
  const [explanation, setExplanation] = useState(match.explanation);
  const [error, setError] = useState<string | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [pending, startTransition] = useTransition();
  const [applying, startApplying] = useTransition();

  const chip = (match.breakdown.eligibility?.chip ?? "unclear") as EligibilityChip;
  const salary = salaryLabel(job.salary_min, job.salary_max, job.salary_currency);
  const reasons = match.breakdown.top_reasons ?? [];
  const isHidden = match.status === "dismissed";
  const description = useMemo(
    () => (job.description_text ?? "").replace(/\s+/g, " ").trim(),
    [job.description_text],
  );
  const skills = useMemo(() => {
    const all = [...termsIn(`${job.title} ${description}`)];
    const mine = all.filter((t) => userTerms.has(t));
    const other = all.filter((t) => !userTerms.has(t));
    return { mine, other: other.slice(0, Math.max(0, 8 - mine.length)) };
  }, [job.title, description, userTerms]);

  const seen = () => {
    if (!isNew) return;
    setIsNew(false);
    onSeen(job.id);
  };

  const runQuickApply = () => {
    seen();
    setError(null);
    // Open the tab now (inside the click), so the browser doesn't block it as a popup.
    const tab = window.open("", "_blank");
    tab?.document.write(
      "<title>JobBuddy</title><p style='font:16px system-ui;padding:32px;color:#444'>JobBuddy is tailoring your CV. The application form opens here in a few seconds...</p>",
    );
    startApplying(async () => {
      const r = await quickApply(job.id);
      if (!r.ok) {
        tab?.close();
        setError(r.error);
        return;
      }
      setApplied({ applicationId: r.applicationId, note: r.note });
      if (tab) tab.location.href = r.applyUrl;
      else window.open(r.applyUrl, "_blank", "noopener");
    });
  };

  const markApplied = () =>
    startTransition(async () => {
      if (!applied) return;
      await moveApplication(applied.applicationId, "applied");
      setApplied({ ...applied, done: true });
      setTimeout(() => onGone(job.id), 1200);
    });

  return (
    <article
      className={cn(
        "border-border bg-card group rounded-xl border p-4 transition-colors sm:p-5",
        "hover:border-primary/40",
        isNew && "border-l-primary border-l-4",
      )}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
            {isNew ? (
              <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 font-semibold">
                New
              </span>
            ) : null}
            <span>{postedLabel(job.posted_at)}</span>
            <span aria-hidden>·</span>
            <span>{SOURCE_LABEL[job.source] ?? job.source}</span>
          </p>
          <h3 className="mt-1 text-base font-semibold leading-snug sm:text-lg">
            <button
              type="button"
              onClick={() => {
                setOpen((o) => !o);
                seen();
              }}
              className={cn(
                "text-left hover:underline",
                isNew ? "text-primary" : "text-foreground",
              )}
              aria-expanded={open}
            >
              {job.title}
            </button>
          </h3>
          <p className="text-sm">
            <span className="font-medium">{job.company_name}</span>
            <span className="text-muted-foreground">
              {" "}
              · {locationLabel(job)}
              {salary ? ` · ${salary}` : ""}
            </span>
          </p>
          {appliedBefore ? (
            <p className="bg-warning/20 mt-2 inline-block rounded-md px-2 py-0.5 text-xs">
              {`You applied to ${job.company_name} on ${appliedOn(appliedBefore.appliedAt)} (${appliedBefore.title}).`}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-center">
          <ScoreRing score={match.score} size={52} />
          <span className="text-muted-foreground text-[11px]">Tech fit</span>
        </div>
      </div>

      {description ? (
        <p
          className={cn(
            "text-muted-foreground mt-3 text-sm leading-relaxed",
            open ? "max-h-96 overflow-y-auto whitespace-pre-line" : "line-clamp-2",
          )}
        >
          {open ? job.description_text : description}
        </p>
      ) : null}

      {skills.mine.length + skills.other.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {skills.mine.map((t) => (
            <Chip key={t} className="bg-success/15 text-success">
              <Check size={12} /> {t}
            </Chip>
          ))}
          {skills.other.map((t) => (
            <Chip key={t} className="bg-muted text-muted-foreground">
              {t}
            </Chip>
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <Chip className={ELIG_STYLE[chip]}>{ELIGIBILITY_LABEL[chip]}</Chip>
          </div>
          {reasons.length > 0 ? (
            <ul className="space-y-1">
              {reasons.map((r) => (
                <li key={r} className="flex gap-2">
                  <Check size={14} className="text-success mt-0.5 shrink-0" />
                  {r}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {explanation ? (
        <p className="bg-brand-soft mt-3 rounded-lg px-3 py-2 text-sm">{explanation}</p>
      ) : null}
      {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}

      {applied ? (
        <div className="bg-success/10 mt-4 flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 text-sm">
          <Check size={16} className="text-success" />
          <span className="flex-1">
            {applied.done
              ? "Moved to Applied."
              : `CV ready${applied.note ? ` (${applied.note})` : ""}. The form is open in a new tab: fill it with the JobBuddy extension, then press Submit.`}
          </span>
          {!applied.done ? (
            <>
              <Link href={`/applications/${applied.applicationId}`} className="underline">
                Check CV
              </Link>
              <Button size="sm" variant="outline" disabled={pending} onClick={markApplied}>
                I applied
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
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
            <Button size="sm" disabled={applying || Boolean(applied)} onClick={runQuickApply}>
              <Zap size={14} /> {applying ? "Tailoring your CV..." : "Quick apply"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={saved}
              aria-label={saved ? "Saved" : "Save"}
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
              <span className="hidden sm:inline">{saved ? "Saved" : "Save"}</span>
            </Button>
            <details className="relative">
              <summary
                className="border-border bg-card hover:bg-muted inline-flex h-8 cursor-pointer list-none items-center gap-1 rounded-md border px-3 text-sm"
                aria-label="More actions"
              >
                <MoreHorizontal size={14} /> <span className="hidden sm:inline">More</span>
              </summary>
              <div className="border-border bg-card absolute left-0 z-20 mt-1 flex w-56 flex-col rounded-lg border p-1 shadow-lg">
                {!explanation ? (
                  <MenuButton
                    onClick={() =>
                      startTransition(async () => {
                        seen();
                        const res = await explainMatch(job.id);
                        if (res.text) setExplanation(res.text);
                        else setError(res.error ?? "Something went wrong.");
                      })
                    }
                  >
                    <Sparkles size={14} /> {pending ? "Thinking..." : "Explain match"}
                  </MenuButton>
                ) : null}
                <MenuButton
                  onClick={() => {
                    setOpen((o) => !o);
                    seen();
                  }}
                >
                  <ChevronDown size={14} /> {open ? "Show less" : "Show full description"}
                </MenuButton>
                <a
                  href={job.apply_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={seen}
                  className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                >
                  <ExternalLink size={14} /> Open job posting
                </a>
                {applied ? (
                  <Link
                    href={`/applications/${applied.applicationId}`}
                    className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                  >
                    <FileText size={14} /> CV and answers
                  </Link>
                ) : null}
                <MenuButton onClick={() => setDismissOpen(true)}>Not for me</MenuButton>
              </div>
            </details>
          </>
        )}
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

function MenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
        onClick();
      }}
      className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
    >
      {children}
    </button>
  );
}
