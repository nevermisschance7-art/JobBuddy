"use client";

import { termsIn } from "@jobbuddy/shared";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Inbox,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MascotSays } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { moveApplication } from "@/lib/actions/applications";
import {
  dismissMatch,
  loadMatchPage,
  markSeen,
  markViewed,
  restoreLastExtensionHide,
  restoreMatch,
  saveMinScore,
  setSaved,
  unskipCompany,
} from "@/lib/actions/matches";
import { quickApply } from "@/lib/actions/quick-apply";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { companyKey, sameJob, type AppliedBefore } from "@/lib/company";
import { PAGE_SIZE, PAGE_SIZES, type PageSize } from "@/lib/board";
import type { MatchCard, MatchCounts, MatchQuery } from "@/lib/matches";
import { JOB_SOURCES } from "@/lib/sources";
import { cn } from "@/lib/utils";
import { JobDrawer } from "./job-drawer";
import { JobItem, type JobActions, type JobState, type QuickApplied } from "./job-item";

type Props = {
  initial: MatchCard[];
  initialTotal: number;
  minScore: number;
  hasCv: boolean;
  counts: MatchCounts;
  userTerms: string[];
  /** Companies applied to in the last 30 days (by companyKey), to warn before a second try. */
  recentApplied: Record<string, AppliedBefore[]>;
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

const POSTED = [
  ["any", "Any time (10 days)"],
  ["new", "Last 24 hours"],
  ["recent", "Last 3 days"],
  ["week", "Last 7 days"],
] as const;

/** Per-viewer conveniences (layout, page size); storage can be blocked, so never required. */
function remember<T extends string>(key: string, fallback: T, allowed: readonly string[]): T {
  try {
    const v = localStorage.getItem(key);
    return v && allowed.includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not saved: the board still works.
  }
}

/** Page numbers to show: first, last and the ones around the current page. */
function pageList(page: number, pages: number): (number | "gap")[] {
  const set = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((p) => p >= 1 && p <= pages)
    .sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  set.forEach((p, i) => {
    if (i > 0 && p - set[i - 1]! > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

export function JobsInbox({
  initial,
  initialTotal,
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
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(PAGE_SIZE);
  const [layout, setLayout] = useState<"list" | "cards">("list");
  const [search, setSearch] = useState("");
  const [fit, setFit] = useState(minScore);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [newCount, setNewCount] = useState(counts.new);
  const [now, setNow] = useState(() => Date.now());
  const [loading, startLoading] = useTransition();
  const [selected, setSelected] = useState<{ id: string; tab: "fit" | "description" } | null>(null);
  // What the board knows per job, shared by its row and its details panel.
  const [viewed, setViewed] = useState<Set<string>>(
    () => new Set(initial.filter((m) => m.viewed_at).map((m) => m.jobs.id)),
  );
  /** Saved or unsaved on this page (else the job's own status says). */
  const [savedNow, setSavedNow] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<Record<string, QuickApplied>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requestId = useRef(0);
  const ready = useRef(false);
  const terms = useMemo(() => new Set(userTerms), [userTerms]);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // The viewer's own layout and page size, from the last visit.
  useEffect(() => {
    setLayout(remember("jb.layout", "list", ["list", "cards"]));
    const s = Number(remember("jb.size", String(PAGE_SIZE), PAGE_SIZES.map(String)));
    setSize(s as PageSize);
  }, []);

  const fetchPage = useCallback((q: MatchQuery, p: number, s: number) => {
    const id = ++requestId.current;
    startLoading(async () => {
      try {
        const res = await loadMatchPage(q, p, s);
        if (id !== requestId.current) return; // a newer change won
        setItems(res.items);
        setTotal(res.total);
        setViewed((prev) => {
          const next = new Set(prev);
          for (const m of res.items) if (m.viewed_at) next.add(m.jobs.id);
          return next;
        });
        setError(null);
      } catch {
        if (id === requestId.current) {
          setError("Couldn't load jobs. Check your connection and try again.");
        }
      }
    });
  }, []);

  // Reload whenever the list, a filter, the page or the page size changes.
  useEffect(() => {
    if (!ready.current) {
      ready.current = true;
      if (size === PAGE_SIZE) return; // the server already sent this page
    }
    fetchPage(query, page, size);
  }, [query, page, size, fetchPage]);

  // Typing in search waits for a pause before reloading.
  useEffect(() => {
    if ((query.search ?? "") === search) return;
    const t = setTimeout(() => {
      setPage(1);
      setQuery((q) => ({ ...q, search: search || undefined }));
    }, 350);
    return () => clearTimeout(t);
  }, [search, query.search]);

  // Tech fit: the list follows the slider at once; the setting is saved when it rests.
  useEffect(() => {
    if ((query.minScore ?? minScore) === fit) return;
    const t = setTimeout(() => {
      setPage(1);
      setQuery((q) => ({ ...q, minScore: fit }));
      void saveMinScore(fit);
    }, 400);
    return () => clearTimeout(t);
  }, [fit, query.minScore, minScore]);

  const set = <K extends keyof MatchQuery>(key: K, value: MatchQuery[K]) => {
    setPage(1);
    setQuery((q) => ({ ...q, [key]: value }));
  };
  const goTo = (p: number) => {
    setPage(p);
    top.current?.scrollIntoView({ block: "start" });
  };

  // ------------------------------------------------ Not for me, with Undo and Ctrl+Z
  type Hidden = { cards: { card: MatchCard; index: number }[]; company?: string };
  const [undoStack, setUndoStack] = useState<Hidden[]>([]);
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
  const reloadRef = useRef<() => void>(() => {});
  reloadRef.current = () => fetchPage(query, page, size);

  const hide = useCallback((jobId: string, company?: string) => {
    const key = company ? companyKey(company) : null;
    const gone = itemsRef.current
      .map((card, index) => ({ card, index }))
      .filter(({ card }) =>
        key ? companyKey(card.jobs.company_name) === key : card.jobs.id === jobId,
      );
    if (gone.length === 0) return;
    setItems((prev) => prev.filter((card) => !gone.some((g) => g.card.id === card.id)));
    setTotal((t) => Math.max(0, t - gone.length));
    setSelected((s) => (s && gone.some((g) => g.card.jobs.id === s.id) ? null : s));
    setUndoStack((stack) => [...stack.slice(-19), { cards: gone, company }]);
    setBarVisible(true);
    for (const { card } of gone) {
      // The company is added to the skip list once, with the job that was clicked.
      void dismissMatch(card.jobs.id, null, "", card.jobs.id === jobId ? (company ?? null) : null);
    }
  }, []);
  const undo = useCallback(() => {
    const last = undoRef.current.at(-1);
    if (!last) {
      // Nothing hidden here: bring back the job hidden last from the extension.
      void restoreLastExtensionHide().then((restored) => {
        if (restored) reloadRef.current();
      });
      return;
    }
    setUndoStack((stack) => stack.slice(0, -1));
    setItems((prev) => {
      const next = [...prev];
      for (const { card, index } of last.cards) next.splice(Math.min(index, next.length), 0, card);
      return next;
    });
    setTotal((t) => t + last.cards.length);
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

  // ------------------------------------------------ job actions
  const markOpened = useCallback((jobId: string) => {
    setViewed((prev) => {
      if (prev.has(jobId)) return prev;
      void markViewed([jobId]);
      return new Set(prev).add(jobId);
    });
  }, []);

  const actions: JobActions = {
    open: (jobId, tab) => {
      setSelected({ id: jobId, tab });
      markOpened(jobId);
    },
    posting: markOpened,
    quickApply: (match) => {
      const jobId = match.jobs.id;
      markOpened(jobId);
      setApplying((s) => new Set(s).add(jobId));
      setErrors((e) => {
        const next = { ...e };
        delete next[jobId];
        return next;
      });
      if (match.status === "new") {
        void markSeen([jobId]);
        setNewCount((n) => Math.max(0, n - 1));
      }
      // Open the tab now (inside the click), so the browser doesn't block it as a popup.
      const tab = window.open("", "_blank");
      tab?.document.write(
        "<title>JobBuddy</title><p style='font:16px system-ui;padding:32px;color:#444'>JobBuddy is tailoring your CV. The application form opens here in a few seconds...</p>",
      );
      void (async () => {
        const r = await quickApply(jobId);
        setApplying((s) => {
          const next = new Set(s);
          next.delete(jobId);
          return next;
        });
        if (!r.ok) {
          tab?.close();
          setErrors((e) => ({ ...e, [jobId]: r.error }));
          return;
        }
        setApplied((a) => ({ ...a, [jobId]: { applicationId: r.applicationId, note: r.note } }));
        if (tab) tab.location.href = r.applyUrl;
        else window.open(r.applyUrl, "_blank", "noopener");
      })();
    },
    markApplied: (jobId) => {
      const a = applied[jobId];
      if (!a) return;
      setApplied((all) => ({ ...all, [jobId]: { ...a, done: true } }));
      void moveApplication(a.applicationId, "applied");
      // Applied jobs leave the board.
      setTimeout(() => {
        setItems((prev) => prev.filter((m) => m.jobs.id !== jobId));
        setTotal((t) => Math.max(0, t - 1));
        setSelected((s) => (s?.id === jobId ? null : s));
      }, 900);
    },
    toggleSave: (match) => {
      const jobId = match.jobs.id;
      const on = !(savedNow[jobId] ?? match.status === "saved");
      setSavedNow((s) => ({ ...s, [jobId]: on }));
      void setSaved(jobId, on);
      if (!on && query.view === "saved") {
        setItems((prev) => prev.filter((m) => m.jobs.id !== jobId));
        setTotal((t) => Math.max(0, t - 1));
      }
    },
    hide,
    restore: (jobId) => {
      setItems((prev) => prev.filter((m) => m.jobs.id !== jobId));
      setTotal((t) => Math.max(0, t - 1));
      setSelected((s) => (s?.id === jobId ? null : s));
      void restoreMatch(jobId);
    },
  };

  const stateOf = (m: MatchCard): JobState => ({
    badge: viewed.has(m.jobs.id) ? "viewed" : "new",
    saved: savedNow[m.jobs.id] ?? m.status === "saved",
    applying: applying.has(m.jobs.id),
    applied: applied[m.jobs.id],
    error: errors[m.jobs.id],
  });

  const skillsOf = useMemo(() => {
    const cache = new Map<string, { mine: string[]; other: string[] }>();
    return (m: MatchCard) => {
      let s = cache.get(m.id);
      if (!s) {
        const all = [...termsIn(`${m.jobs.title} ${m.jobs.description_text ?? ""}`)];
        const mine = all.filter((t) => terms.has(t));
        const other = all.filter((t) => !terms.has(t));
        s = { mine: mine.slice(0, 6), other: other.slice(0, Math.max(0, 7 - mine.length)) };
        cache.set(m.id, s);
      }
      return s;
    };
  }, [terms]);

  const appliedBeforeOf = (m: MatchCard) =>
    (recentApplied[companyKey(m.jobs.company_name)] ?? []).find((a) =>
      sameJob(a, { id: m.jobs.id, title: m.jobs.title, description: m.jobs.description_text }),
    );

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
    view === query.view
      ? total
      : view === "inbox"
        ? counts.inbox
        : view === "new"
          ? newCount
          : view === "saved"
            ? counts.saved
            : counts.hidden;
  const pages = Math.max(1, Math.ceil(total / size));
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const selectedMatch = selected ? items.find((m) => m.jobs.id === selected.id) : undefined;
  const heading = VIEWS.find(([v]) => v === query.view)![1];

  return (
    <div className="grid gap-6 lg:grid-cols-[232px_minmax(0,1fr)]">
      {/* Rail: lists and filters */}
      <aside className="flex flex-col gap-5 lg:sticky lg:top-20 lg:self-start">
        <nav role="tablist" aria-label="Job lists" className="scroll-x flex gap-1 lg:flex-col">
          {VIEWS.map(([view, label, Icon]) => (
            <button
              key={view}
              role="tab"
              aria-selected={query.view === view}
              onClick={() => set("view", view)}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium",
                query.view === view
                  ? "bg-card text-foreground ring-border shadow-sm ring-1"
                  : "text-muted-foreground hover:bg-card hover:text-foreground",
              )}
            >
              <Icon size={15} />
              <span className="flex-1 text-left">{label}</span>
              <span className="text-muted-foreground font-mono text-xs tabular-nums">
                {countFor(view)}
              </span>
            </button>
          ))}
        </nav>

        <div className="border-border bg-card flex flex-col gap-1 rounded-xl border p-3.5">
          <div className="flex items-baseline justify-between">
            <label
              htmlFor="fit"
              className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider"
            >
              Tech fit
            </label>
            <b className="font-mono text-lg tabular-nums">{fit === 0 ? "All" : `${fit}+`}</b>
          </div>
          <input
            id="fit"
            type="range"
            min={0}
            max={90}
            step={5}
            value={fit}
            onChange={(e) => setFit(Number(e.target.value))}
            className="accent-primary my-1 w-full"
          />
          <p className="text-muted-foreground text-xs">
            {query.view === "inbox"
              ? `${total} jobs at this fit or higher`
              : "Applies to every list"}
          </p>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-wider">
            Posted
          </legend>
          {POSTED.map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="posted"
                value={value}
                checked={query.freshness === value}
                onChange={() => set("freshness", value)}
                className="accent-primary"
              />
              {label}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Country
            <Combobox
              ariaLabel="Country"
              value={query.country ?? ""}
              onChange={(v) => set("country", v || undefined)}
              options={[{ value: "", label: "Any country" }, ...COUNTRY_OPTIONS]}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Source
            <Combobox
              ariaLabel="Source"
              value={query.source ?? ""}
              onChange={(v) => set("source", (v || undefined) as MatchQuery["source"])}
              options={[
                { value: "", label: "Any source" },
                ...JOB_SOURCES.map((s) => ({ value: s, label: s })),
              ]}
            />
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
      <section className="flex min-w-0 flex-col gap-3" ref={top}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px]">
              {runState === "rescoring" ? (
                <span className="text-primary inline-flex items-center gap-1.5 font-medium">
                  <RefreshCw size={13} className="animate-spin" /> Re-scoring your jobs with your
                  new CV or filters (usually 10 to 15 minutes)
                </span>
              ) : runState === "running" ? (
                <span className="text-primary inline-flex items-center gap-1.5 font-medium">
                  <RefreshCw size={13} className="animate-spin" /> Searching for new jobs now
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="bg-success inline-block h-1.5 w-1.5 rounded-full" /> Updated{" "}
                  {ago(matchedAt, now)}
                </span>
              )}
              <span aria-hidden>·</span>
              <span>next search around {nextUpdate(now)}</span>
              {newCount > 0 && query.view !== "new" ? (
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
            </p>
          </div>
          <div
            role="group"
            aria-label="Layout"
            className="border-border bg-card inline-flex h-9 rounded-lg border p-0.5"
          >
            {(
              [
                ["list", "List", List],
                ["cards", "Cards", LayoutGrid],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={layout === value}
                onClick={() => {
                  setLayout(value);
                  store("jb.layout", value);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 text-[13px] font-medium",
                  layout === value
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="border-border bg-card text-muted-foreground focus-within:ring-ring flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border px-3 focus-within:ring-2">
            <Search size={15} />
            <input
              aria-label="Search jobs"
              placeholder="Search title, company or technology"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <div
            role="group"
            aria-label="Jobs per page"
            className="border-border bg-card inline-flex h-9 items-center rounded-lg border p-0.5"
          >
            <span className="text-muted-foreground px-2 text-xs">Per page</span>
            {PAGE_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={size === s}
                onClick={() => {
                  setSize(s);
                  setPage(1);
                  store("jb.size", String(s));
                }}
                className={cn(
                  "h-full rounded-md px-2.5 font-mono text-[13px]",
                  size === s ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {showFilters ? (
          <div id="filters" className="border-border bg-card rounded-xl border p-4">
            <h2 className="mb-3 font-semibold">My filters</h2>
            {filtersPanel}
          </div>
        ) : null}

        {query.view === "inbox" && counts.below > 0 && fit > 0 && fit === minScore ? (
          <p className="bg-brand-soft rounded-lg px-3 py-2 text-sm">
            {counts.below} more job{counts.below === 1 ? "" : "s"} pass your filters with a tech fit
            under {fit}.{" "}
            <button
              type="button"
              className="text-primary font-medium underline"
              onClick={() => setFit(0)}
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

        {items.length === 0 && !loading ? (
          <MascotSays mood={query.view === "inbox" ? "sleepy" : "thinking"}>
            {query.view === "saved"
              ? "Nothing saved yet. Press Save on a job to keep it here."
              : query.view === "hidden"
                ? "No hidden jobs."
                : query.view === "new"
                  ? "No new jobs: you've applied to all of them. New ones arrive every 2 hours."
                  : query.search
                    ? "No job matches that search."
                    : "No matches yet. I search right after you change your CV or filters (results in about 15 minutes), and every 2 hours."}
          </MascotSays>
        ) : (
          <div
            aria-busy={loading}
            className={cn(
              "transition-opacity",
              loading && "pointer-events-none opacity-50",
              layout === "list"
                ? "border-border bg-card overflow-visible rounded-xl border"
                : "grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3",
            )}
          >
            {items.map((m) => (
              <JobItem
                key={m.id}
                match={m}
                layout={layout}
                state={stateOf(m)}
                skills={skillsOf(m)}
                appliedBefore={appliedBeforeOf(m)}
                selected={selected?.id === m.jobs.id}
                hiddenView={query.view === "hidden"}
                actions={actions}
              />
            ))}
          </div>
        )}

        {total > 0 ? (
          <nav
            aria-label="Pages"
            className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-[13px]"
          >
            <span>
              {first}–{Math.min(total, first + items.length - 1)} of {total} jobs
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => goTo(page - 1)}
                className="hover:bg-card grid h-8 w-8 place-items-center rounded-lg disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              {pageList(page, pages).map((p, i) =>
                p === "gap" ? (
                  <span key={`gap${i}`} aria-hidden className="px-1">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    aria-current={p === page ? "page" : undefined}
                    onClick={() => goTo(p)}
                    className={cn(
                      "h-8 min-w-8 rounded-lg px-2 font-mono tabular-nums",
                      p === page
                        ? "bg-foreground text-background"
                        : "hover:bg-card hover:text-foreground",
                    )}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= pages}
                onClick={() => goTo(page + 1)}
                className="hover:bg-card grid h-8 w-8 place-items-center rounded-lg disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </nav>
        ) : null}

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
      </section>

      {selected && selectedMatch ? (
        <JobDrawer
          match={selectedMatch}
          tab={selected.tab}
          onTab={(tab) => setSelected({ id: selected.id, tab })}
          onClose={() => setSelected(null)}
          state={stateOf(selectedMatch)}
          skills={skillsOf(selectedMatch)}
          actions={actions}
          hiddenView={query.view === "hidden"}
        />
      ) : null}
    </div>
  );
}
