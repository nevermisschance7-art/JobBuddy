"use client";

import { Check, ExternalLink, FileText, StickyNote } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/field";
import { moveApplication, saveNotes } from "@/lib/actions/applications";

export type AppRow = {
  id: string;
  status: string;
  applied_at: string | null;
  created_at: string;
  notes: string | null;
  cv_approved_at: string | null;
  jobs: { title: string; company_name: string; apply_url: string };
};

export const STATUS_LABEL: Record<string, string> = {
  prepared: "Ready to apply",
  applied: "Applied",
  assessment: "Assessment",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  ghosted: "No reply",
  withdrawn: "Withdrawn",
};

const STATUS_STYLE: Record<string, string> = {
  prepared: "bg-brand-soft text-primary",
  applied: "bg-info/15 text-info",
  assessment: "bg-warning/20 text-foreground",
  interview: "bg-warning/20 text-foreground",
  offer: "bg-success/15 text-success",
  rejected: "bg-muted text-muted-foreground",
  ghosted: "bg-muted text-muted-foreground",
  withdrawn: "bg-muted text-muted-foreground",
};

const date = (iso: string) =>
  new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

function Row({ item }: { item: AppRow }) {
  const [status, setStatus] = useState(item.status);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [showNotes, setShowNotes] = useState(false);
  const [pending, startTransition] = useTransition();
  const move = (next: string) =>
    startTransition(async () => {
      setStatus(next);
      await moveApplication(item.id, next);
    });

  return (
    <li className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/applications/${item.id}`} className="font-semibold hover:underline">
            {item.jobs.title}
          </Link>
          <p className="text-muted-foreground text-sm">
            {item.jobs.company_name} ·{" "}
            {item.applied_at
              ? `Applied ${date(item.applied_at)}`
              : `Prepared ${date(item.created_at)}`}
            {item.cv_approved_at ? " · CV ready" : " · CV not approved yet"}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? ""}`}
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {status === "prepared" ? (
          <>
            <a
              href={item.jobs.apply_url}
              target="_blank"
              rel="noreferrer"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium"
            >
              <ExternalLink size={14} /> Open form
            </a>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => move("applied")}>
              <Check size={14} /> I applied
            </Button>
          </>
        ) : null}
        <Link
          href={`/applications/${item.id}`}
          className="border-border hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm"
        >
          <FileText size={14} /> CV and answers
        </Link>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowNotes((s) => !s)}
          aria-expanded={showNotes}
        >
          <StickyNote size={14} /> Notes{notes ? " ✓" : ""}
        </Button>
        <Select
          aria-label={`Status of ${item.jobs.title}`}
          value={status}
          disabled={pending}
          className="ml-auto h-8 w-auto text-xs"
          onChange={(e) => move(e.target.value)}
        >
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      {showNotes ? (
        <Textarea
          aria-label="Notes"
          placeholder="Notes: recruiter name, interview date..."
          className="min-h-16 text-sm"
          value={notes}
          maxLength={2000}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() =>
            notes !== (item.notes ?? "") && startTransition(() => saveNotes(item.id, notes))
          }
        />
      ) : null}
    </li>
  );
}

export function AppList({ items }: { items: AppRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <Row key={item.id} item={item} />
      ))}
    </ul>
  );
}
