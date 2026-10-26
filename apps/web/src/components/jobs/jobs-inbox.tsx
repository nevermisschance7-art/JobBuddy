"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { MascotSays } from "@/components/mascot";
import { Input, Select } from "@/components/ui/field";
import { loadMoreMatches } from "@/lib/actions/matches";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import type { MatchCard, MatchQuery } from "@/lib/matches";
import { cn } from "@/lib/utils";
import { JobCard } from "./job-card";

const SOURCES = [
  "greenhouse", "lever", "ashby", "workable", "smartrecruiters", "teamtailor", "adzuna",
  "reed", "jooble", "remotive", "himalayas", "arbeitnow", "remoteok", "weworkremotely",
]; // prettier-ignore

const PAGE_SIZE = 20;

type Props = {
  initial: MatchCard[];
  minScore: number;
  hasCv: boolean;
};

export function JobsInbox({ initial, minScore, hasCv }: Props) {
  const [query, setQuery] = useState<MatchQuery>({
    view: "inbox",
    maxScore: 100,
    freshness: "any",
    remote: "any",
  });
  const [items, setItems] = useState<MatchCard[]>(initial);
  const [done, setDone] = useState(initial.length < PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const sentinel = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const requestId = useRef(0);

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
        setError("Couldn't load jobs. Check your connection and try again.");
      }
    });
  }, []);

  // Refetch from the top whenever filters change (debounced for typing).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
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

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Job lists" className="border-border flex gap-1 border-b">
        {(
          [
            ["inbox", "Matches"],
            ["saved", "Saved"],
            ["hidden", "Hidden"],
          ] as const
        ).map(([view, label]) => (
          <button
            key={view}
            role="tab"
            aria-selected={query.view === view}
            onClick={() => set("view", view)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm",
              query.view === view
                ? "border-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Input
          aria-label="Search title or company"
          placeholder="Search"
          className="col-span-2"
          value={query.search ?? ""}
          onChange={(e) => set("search", e.target.value)}
        />
        <Select
          aria-label="Minimum score"
          value={query.minScore ?? minScore}
          onChange={(e) => set("minScore", Number(e.target.value))}
        >
          {[30, 40, 50, 55, 60, 70, 80, 90].map((s) => (
            <option key={s} value={s}>
              Score {s}+
            </option>
          ))}
        </Select>
        <Select
          aria-label="Freshness"
          value={query.freshness}
          onChange={(e) => set("freshness", e.target.value as MatchQuery["freshness"])}
        >
          <option value="any">Any date</option>
          <option value="new">New (24h)</option>
          <option value="recent">Recent (3 days)</option>
          <option value="relevant">Last 2 weeks</option>
          <option value="older">Older</option>
        </Select>
        <Select
          aria-label="Work style"
          value={query.remote}
          onChange={(e) => set("remote", e.target.value as MatchQuery["remote"])}
        >
          <option value="any">Any style</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">On-site</option>
        </Select>
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
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {items.length === 0 && !loading ? (
        <MascotSays mood={query.view === "inbox" ? "sleepy" : "thinking"}>
          {query.view === "saved"
            ? "Nothing saved yet. Tap Save on a job to keep it here."
            : query.view === "hidden"
              ? "No hidden jobs."
              : "No matches yet. I start a search right after you change your CV or filters, and results arrive within about 15 minutes. I also check every 2 hours."}
        </MascotSays>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((m) => (
            <JobCard
              key={m.id}
              match={m}
              onGone={(jobId) => setItems((prev) => prev.filter((x) => x.jobs.id !== jobId))}
            />
          ))}
        </div>
      )}

      <div ref={sentinel} aria-hidden className="h-8" />
      {loading ? (
        <div className="flex flex-col gap-3" aria-label="Loading jobs">
          {[0, 1].map((i) => (
            <div key={i} className="bg-muted h-40 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
