"use client";

import { Bookmark, BookmarkCheck, Check, Clock, MapPin, MoreHorizontal, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { locationLabel, postedLabel } from "@/lib/job-display";
import type { AppliedBefore } from "@/lib/company";
import type { MatchCard } from "@/lib/matches";
import { cn } from "@/lib/utils";
import { JobMenu } from "./job-menu";
import { ScoreRing } from "./score-ring";

export type Badge = "new" | "viewed";
export type QuickApplied = { applicationId: string; note?: string; done?: boolean };

/** What the board knows about one job right now (shared by its row and its details panel). */
export type JobState = {
  badge: Badge;
  saved: boolean;
  applying: boolean;
  applied?: QuickApplied;
  error?: string;
};

export type JobActions = {
  open: (jobId: string, tab: "fit" | "description") => void;
  quickApply: (match: MatchCard) => void;
  markApplied: (jobId: string) => void;
  toggleSave: (match: MatchCard) => void;
  hide: (jobId: string, company?: string) => void;
  restore: (jobId: string) => void;
  posting: (jobId: string) => void;
};

/** A steady colour per company for its initial (white text reads on all of them). */
const COMPANY_COLOURS = [
  "#e4572e", "#2563eb", "#0f766e", "#7c3aed", "#db2777", "#ea580c",
  "#0284c7", "#16a34a", "#9333ea", "#b45309", "#0891b2", "#4f46e5",
]; // prettier-ignore
function companyColour(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COMPANY_COLOURS[h % COMPANY_COLOURS.length]!;
}

export function CompanyMark({ name, size = 36 }: { name: string; size?: number }) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[10px] text-sm font-bold text-white"
      style={{ background: companyColour(name), width: size, height: size }}
    >
      {letter}
    </span>
  );
}

function BadgePill({ badge }: { badge: Badge }) {
  return badge === "new" ? (
    <span className="bg-brand-soft text-primary rounded-full px-2 py-0.5 text-[11px] font-semibold">
      New
    </span>
  ) : (
    <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[11px] font-semibold">
      Viewed
    </span>
  );
}

export function TechChips({ mine, other }: { mine: string[]; other: string[] }) {
  if (mine.length + other.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {mine.map((t) => (
        <span
          key={t}
          className="bg-success/15 text-success rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-medium"
        >
          {t}
        </span>
      ))}
      {other.map((t) => (
        <span
          key={t}
          className="border-border text-muted-foreground rounded-md border px-1.5 py-0.5 font-mono text-[11.5px]"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

const appliedOn = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** One job, as a list row or a card. */
export function JobItem({
  match,
  layout,
  state,
  skills,
  appliedBefore,
  selected,
  hiddenView,
  actions,
}: {
  match: MatchCard;
  layout: "list" | "cards";
  state: JobState;
  skills: { mine: string[]; other: string[] };
  appliedBefore?: AppliedBefore;
  selected: boolean;
  hiddenView: boolean;
  actions: JobActions;
}) {
  const job = match.jobs;
  const meta = (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px]">
      {layout === "list" ? <span className="text-foreground/80">{job.company_name}</span> : null}
      <span className="inline-flex items-center gap-1">
        <MapPin size={12} /> {locationLabel(job)}
      </span>
      <span className="inline-flex items-center gap-1">
        <Clock size={12} /> {postedLabel(job.posted_at)}
      </span>
      {layout === "cards" ? <BadgePill badge={state.badge} /> : null}
    </div>
  );
  const warning = appliedBefore ? (
    <p className="text-destructive text-xs font-medium">
      {`Same job as one you applied to on ${appliedOn(appliedBefore.appliedAt)} (posted again or on another board).`}
    </p>
  ) : null;

  const buttons = (
    <div
      className={cn("flex items-center gap-1", layout === "cards" && "w-full")}
      onClick={(e) => e.stopPropagation()}
    >
      {hiddenView ? (
        <Button variant="outline" size="sm" onClick={() => actions.restore(job.id)}>
          Show again
        </Button>
      ) : (
        <>
          <Button
            size="sm"
            className={cn("font-semibold", layout === "cards" && "mr-auto")}
            disabled={state.applying || Boolean(state.applied)}
            onClick={() => actions.quickApply(match)}
          >
            <Zap size={14} /> {state.applying ? "Tailoring CV..." : "Quick apply"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("w-8 px-0", state.saved && "text-primary")}
            aria-pressed={state.saved}
            aria-label={state.saved ? "Saved" : "Save"}
            title={state.saved ? "Saved" : "Save"}
            onClick={() => actions.toggleSave(match)}
          >
            {state.saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
          </Button>
          <JobMenu
            company={job.company_name}
            onExplain={() => actions.open(job.id, "fit")}
            onDescription={() => actions.open(job.id, "description")}
            onPosting={() => actions.posting(job.id)}
            postingUrl={job.apply_url}
            onHide={() => actions.hide(job.id)}
            onHideCompany={() => actions.hide(job.id, job.company_name)}
          >
            <MoreHorizontal size={16} />
          </JobMenu>
        </>
      )}
    </div>
  );

  const quick = state.applied ? (
    <div
      className="bg-success/10 flex flex-wrap items-center gap-3 rounded-lg px-3 py-2 text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <Check size={16} className="text-success" />
      <span className="flex-1">
        {state.applied.done
          ? "Moved to Applied."
          : `CV ready${state.applied.note ? ` (${state.applied.note})` : ""}. The form is open in a new tab: fill it with the JobBuddy extension, then press Submit.`}
      </span>
      {!state.applied.done ? (
        <>
          <Link href={`/applications/${state.applied.applicationId}`} className="underline">
            Check CV
          </Link>
          <Button size="sm" variant="outline" onClick={() => actions.markApplied(job.id)}>
            I applied
          </Button>
        </>
      ) : null}
    </div>
  ) : null;
  const error = state.error ? <p className="text-destructive text-sm">{state.error}</p> : null;

  const title = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        actions.open(job.id, "fit");
      }}
      className="min-w-0 truncate text-left font-semibold hover:underline"
    >
      {job.title}
    </button>
  );

  if (layout === "list") {
    return (
      <article
        onClick={() => actions.open(job.id, "fit")}
        className={cn(
          "border-border flex cursor-pointer flex-col gap-2 border-b px-4 py-3 last:border-b-0",
          "hover:bg-muted/50",
          selected && "bg-muted/60 shadow-[inset_3px_0_0_var(--primary)]",
        )}
      >
        <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3.5 xl:grid-cols-[40px_36px_minmax(0,1.4fr)_minmax(0,1fr)_auto]">
          <ScoreRing score={match.score} size={40} />
          <span className="hidden xl:block">
            <CompanyMark name={job.company_name} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              {title}
              <BadgePill badge={state.badge} />
            </div>
            {meta}
            {warning}
          </div>
          <div className="hidden xl:block">
            <TechChips mine={skills.mine} other={skills.other} />
          </div>
          {buttons}
        </div>
        {quick}
        {error}
      </article>
    );
  }

  return (
    <article
      onClick={() => actions.open(job.id, "fit")}
      className={cn(
        "border-border bg-card flex min-w-0 cursor-pointer flex-col gap-2.5 rounded-xl border p-3.5 transition-[border-color,box-shadow]",
        "hover:border-foreground/20 hover:shadow-md",
        selected && "border-primary",
      )}
    >
      <div className="flex items-start gap-2.5">
        <CompanyMark name={job.company_name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              actions.open(job.id, "fit");
            }}
            className="text-left font-semibold leading-snug hover:underline"
          >
            {job.title}
          </button>
          <span className="text-muted-foreground text-[13px]">{job.company_name}</span>
        </div>
        <ScoreRing score={match.score} size={40} />
      </div>
      {meta}
      {warning}
      <TechChips mine={skills.mine} other={skills.other} />
      <div className="mt-auto flex items-center pt-1">{buttons}</div>
      {quick}
      {error}
    </article>
  );
}
