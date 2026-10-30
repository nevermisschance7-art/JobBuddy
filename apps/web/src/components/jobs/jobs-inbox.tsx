"use client";

import { Bookmark, EyeOff, Inbox, RefreshCw, SlidersHorizontal, Sparkle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MascotSays } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import {
  dismissMatch,
  loadMoreMatches,
  markSeen,
  restoreMatch,
  saveMinScore,
  unskipCompany,
} from "@/lib/actions/matches";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import type { MatchCard, MatchCounts, MatchQuery } from "@/lib/matches";
import { cn } from "@/lib/utils";
import { companyKey, type AppliedBefore } from "@/lib/company";
import { JobCard } from "./job-card";

const SOURCES = [
  "greenhouse", "lever", "ashby", "workable", "smartrecruiters", "teamtailor", "workday",
  "personio", "recruitee", "adzuna", "reed", "jooble", "remotive", "himalayas", "arbeitnow",
  "weworkremotely", "jobicy", "hackernews",
]; // prettier-ignore

const PAGE_SIZE = 20;

type Props = {
  initial: MatchCard[];
  minScore: number;
  hasCv: boolean;
  counts: MatchCounts;
  userTerms: string[];
  /** Companies applied to in the last 30 days (by companyKey), to warn before a second try. */
  recentApplied: Record<string, AppliedBefore>;
  /** When this user's matches were last refreshed (ISO), or null. */
  matchedAt: string | null;
  /** rescoring: CV or filters changed since the last scoring; running: a search is on now. */
  runState: "idle" | "running" | "rescoring";
  /** The saved-filters form, shown when "Edit my filters" is open. */
  filtersPanel: React.ReactNode;
};

/** "12 min ago", "3 h ago". */
function ago(iso: string | null, now: number): string {
  if (!iso) return "not yet";
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** Searches start every 2 hours at :15 UTC and finish ~20 minutes later. */
function nextUpdate(now: number): string {
  const d = new Date(now);
  d.setUTCMinutes(35, 0, 0);
  while (d.getTime() <= now || d.getUTCHours() % 2 !== 0) d.setTime(d.getTime() + 3_600_000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const VIEWS = [
  ["inbox", "Best matches", Inbox],
  ["new", "New", Sparkle],
  ["saved", "Saved", Bookmark],
  ["hidden", "Hidden", EyeOff],
] as const;

export function JobsInbox({
  initial,
  minScore,
  hasCv,
  counts,
  userTerms,
  recentApplied,
  matchedAt,
  runState,
  filtersPanel,
}: Props) {
  const [query, setQuery] = useState<MatchQuery>({
    view: "inbox",
    maxScore: 100,
    freshness: "any",
    remote: "any",
  });
  const [items, setItems] = useState<MatchCard[]>(initial);
  const [done, setDone] = useState(initial.length < PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [newCount, setNewCount] = useState(counts.new);
  const [now, setNow] = useState(() => Date.now());
  const [loading, startLoading] = useTransition();
  /** The list is being reloaded for new filters: the old cards are dimmed meanwhile. */
  const [replacing, setReplacing] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const requestId = useRef(0);
  const seenQueue = useRef<Set<string>>(new Set());
  const terms = useMemo(() => new Set(userTerms), [userTerms]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // "Seen" is saved in small batches.
  useEffect(() => {
    const t = setInterval(() => {
      const ids = [...seenQueue.current];
      if (ids.length === 0) return;
      seenQueue.current.clear();
      void markSeen(ids);
    }, 1500);
    return () => clearInterval(t);
  }, []);
  // "Not for me": gone at once, saved in the background, with Undo (button or Ctrl+Z).
  type Hidden = { cards: { card: MatchCard; index: number }[]; company?: string };
  const [undoStack, setUndoStack] = useState<Hidden[]>([]);
  // The Undo bar shows for 8 seconds after each hide; Ctrl+Z keeps working after that.
  const [barVisible, setBarVisible] = useState(false);
  useEffect(() => {
    if (!barVisible) return;
    const t = setTimeout(() => setBarVisible(false), 8000);
    return () => clearTimeout(t);
  }, [barVisible, undoStack]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const undoRef = useRef(undoStack);
  undoRef.current = undoStack;
  const onHide = useCallback((jobId: string, company?: string) => {
    const key = company ? companyKey(company) : null;
    const gone = itemsRef.current
      .map((card, index) => ({ card, index }))
      .filter(({ card }) =>
        key ? companyKey(card.jobs.company_name) === key : card.jobs.id === jobId,
      );
    if (gone.length === 0) return;
    setItems((prev) => prev.filter((card) => !gone.some((g) => g.card.id === card.id)));
    setUndoStack((stack) => [...stack.slice(-19), { cards: gone, company }]);
    setBarVisible(true);
    for (const { card } of gone) {
      // The company is added to the skip list once, with the job that was clicked.
      void dismissMatch(card.jobs.id, null, "", card.jobs.id === jobId ? (company ?? null) : null);
    }
  }, []);
  const undo = useCallback(() => {
    const last = undoRef.current.at(-1);
    if (!last) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setItems((prev) => {
      const next = [...prev];
      for (const { card, index } of last.cards) next.splice(Math.min(index, next.length), 0, card);
      return next;
    });
    for (const { card } of last.cards) void restoreMatch(card.jobs.id);
    if (last.company) void unskipCompany(last.company);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);
  const lastHidden = undoStack.at(-1);

  const seenIds = useRef<Set<string>>(new Set());
  const onSeen = useCallback((jobId: string) => {
    if (seenIds.current.has(jobId)) return; // shown and then opened: counted once
    seenIds.current.add(jobId);
    seenQueue.current.add(jobId);
    setNewCount((n) => Math.max(0, n - 1));
  }, []);

  const fetchPage = useCallback((q: MatchQuery, offset: number, replace: boolean) => {
    const id = ++requestId.current;
    startLoading(async () => {
      try {
        const page = await loadMoreMatches(q, offset);
        if (id !== requestId.current) return; // a newer filter change won
        setItems((prev) => (replace ? page : [...prev, ...page]));
        setDone(page.length < PAGE_SIZE);
        setError(null);
      } catch {
        if (id === requestId.current) {
          setError("Couldn't load jobs. Check your connection and try again.");
        }
      } finally {
        if (id === requestId.current) setReplacing(false);
      }
    });
  }, []);

  // Refetch from the top whenever filters change (debounced for typing).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setReplacing(true); // show "Updating" at once, not after the typing pause
    const t = setTimeout(() => fetchPage(query, 0, true), 300);
    return () => clearTimeout(t);
  }, [query, fetchPage]);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading) fetchPage(query, items.length, false);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [done, loading, items.length, query, fetchPage]);

  const set = <K extends keyof MatchQuery>(key: K, value: MatchQuery[K]) =>
    setQuery((q) => ({ ...q, [key]: value }));
  // Tech fit is the one saved setting on this page; it applies right away and next visit.
  const changeMin = (value: number) => {
    set("minScore", value);
    void saveMinScore(value);
  };

  if (!hasCv) {
    return (
      <MascotSays mood="thinking">
        I need your confirmed CV before I can match jobs.{" "}
        <a className="underline" href="/settings#cv">
          Add it in Settings
        </a>
        .
      </MascotSays>
    );
  }

  const countFor = (view: MatchQuery["view"]) =>
    view === "inbox"
      ? counts.inbox
      : view === "new"
        ? newCount
        : view === "saved"
          ? counts.saved
          : counts.hidden;
  const effectiveMin = query.minScore ?? minScore;

  return (
    <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
      {/* Sidebar: lists and quick filters */}
      <aside className="flex flex-col gap-5 lg:sticky lg:top-4 lg:self-start">
        <nav role="tablist" aria-label="Job lists" className="scroll-x flex gap-1 lg:flex-col">
          {VIEWS.map(([view, label, Icon]) => (
            <button
              key={view}
              role="tab"
              aria-selected={query.view === view}
              onClick={() => set("view", view)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm",
                query.view === view
                  ? "bg-brand-soft text-primary font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon size={15} />
              <span className="flex-1 text-left">{label}</span>
              <span className="text-xs tabular-nums">{countFor(view)}</span>
            </button>
          ))}
        </nav>

        <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4">
          <Input
            aria-label="Search title or company"
            placeholder="Search title or company"
            value={query.search ?? ""}
            onChange={(e) => set("search", e.target.value)}
          />
          <label className="flex flex-col gap-1 text-xs font-medium">
            Posted
            <Select
              aria-label="Freshness"
              value={query.freshness}
              onChange={(e) => set("freshness", e.target.value as MatchQuery["freshness"])}
            >
              <option value="any">Any time (7 days)</option>
              <option value="new">Last 24 hours</option>
              <option value="recent">Last 3 days</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Tech fit
            <Select
              aria-label="Minimum score"
              value={effectiveMin}
              onChange={(e) => changeMin(Number(e.target.value))}
            >
              {[0, 10, 20, 30, 40, 50, 55, 60, 70, 80, 90].map((s) => (
                <option key={s} value={s}>
                  {s}+
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Country
            <Select
              aria-label="Country"
              value={query.country ?? ""}
              onChange={(e) => set("country", e.target.value || undefined)}
            >
              <option value="">Any country</option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Source
            <Select
              aria-label="Source"
              value={query.source ?? ""}
              onChange={(e) => set("source", (e.target.value || undefined) as MatchQuery["source"])}
            >
              <option value="">Any source</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
          >
            <SlidersHorizontal size={14} /> {showFilters ? "Close my filters" : "Edit my filters"}
          </Button>
        </div>
      </aside>

      {/* Main column */}
      <section className="flex min-w-0 flex-col gap-4">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {runState === "rescoring" ? (
            <span className="text-primary inline-flex items-center gap-1.5 font-medium">
              <RefreshCw size={13} className="animate-spin" /> Re-scoring your jobs with your new CV
              or filters (usually 10 to 15 minutes)
            </span>
          ) : runState === "running" ? (
            <span className="text-primary inline-flex items-center gap-1.5 font-medium">
              <RefreshCw size={13} className="animate-spin" /> Searching for new jobs now
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={13} /> Updated {ago(matchedAt, now)}
            </span>
          )}
          <span aria-hidden>·</span>
          <span>Next update around {nextUpdate(now)}</span>
          {newCount > 0 ? (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="text-primary font-medium hover:underline"
                onClick={() => set("view", "new")}
              >
                {newCount} new
              </button>
            </>
          ) : null}
        </div>

        {showFilters ? (
          <div id="filters" className="border-border bg-card rounded-xl border p-4">
            <h2 className="mb-3 font-semibold">My filters</h2>
            {filtersPanel}
          </div>
        ) : null}

        {query.view === "inbox" && counts.below > 0 && effectiveMin > 0 ? (
          <p className="bg-brand-soft rounded-lg px-3 py-2 text-sm">
            {counts.below} more job{counts.below === 1 ? "" : "s"} pass your filters with a tech fit
            under {effectiveMin}.{" "}
            <button
              type="button"
              className="text-primary font-medium underline"
              onClick={() => changeMin(0)}
            >
              Show them too
            </button>
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        {replacing ? (
          <p
            role="status"
            className="bg-brand-soft text-primary inline-flex items-center gap-2 self-start rounded-full px-3 py-1 text-sm font-medium"
          >
            <RefreshCw size={14} className="animate-spin" /> Updating your list...
          </p>
        ) : null}

        {items.length === 0 && !loading && !replacing ? (
          <MascotSays mood={query.view === "inbox" ? "sleepy" : "thinking"}>
            {query.view === "saved"
              ? "Nothing saved yet. Tap Save on a job to keep it here."
              : query.view === "hidden"
                ? "No hidden jobs."
                : query.view === "new"
                  ? "You've seen every new job. New ones arrive every 2 hours."
                  : "No matches yet. I search right after you change your CV or filters (results in about 15 minutes), and every 2 hours."}
          </MascotSays>
        ) : (
          <div
            className={cn(
              "flex flex-col gap-3 transition-opacity",
              replacing && "pointer-events-none opacity-40",
            )}
            aria-busy={replacing}
          >
            {items.map((m) => (
              <JobCard
                key={m.id}
                match={m}
                userTerms={terms}
                appliedBefore={recentApplied[companyKey(m.jobs.company_name)]}
                onSeen={onSeen}
                onHide={onHide}
                onGone={(jobId) => setItems((prev) => prev.filter((x) => x.jobs.id !== jobId))}
              />
            ))}
          </div>
        )}

        {lastHidden && barVisible ? (
          <div
            role="status"
            className="bg-foreground text-background fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-full px-5 py-2.5 text-sm shadow-lg"
          >
            <span>
              {lastHidden.company
                ? `Hidden every job from ${lastHidden.company}`
                : `Hidden: ${lastHidden.cards[0]?.card.jobs.title ?? "job"}`}
            </span>
            <button type="button" onClick={undo} className="font-semibold underline">
              Undo
            </button>
            <span className="opacity-60">Ctrl+Z</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setBarVisible(false)}
              className="opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </div>
        ) : null}

        <div ref={sentinel} aria-hidden className="h-8" />
        {loading ? (
          <div className="flex flex-col gap-3" aria-label="Loading jobs">
            {[0, 1].map((i) => (
              <div key={i} className="bg-muted h-40 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
