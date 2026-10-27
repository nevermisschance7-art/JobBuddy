"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Select, Textarea } from "@/components/ui/field";
import { moveApplication, saveNotes } from "@/lib/actions/applications";

export type BoardItem = {
  id: string;
  status: string;
  applied_at: string | null;
  notes: string | null;
  updated_at: string;
  jobs: { title: string; company_name: string; apply_url: string };
};

export const COLUMNS = [
  ["prepared", "Prepared"],
  ["applied", "Applied"],
  ["assessment", "Assessment"],
  ["interview", "Interview"],
  ["offer", "Offer"],
  ["rejected", "Rejected"],
  ["ghosted", "Ghosted"],
] as const;

function Card({ item }: { item: BoardItem }) {
  const [notes, setNotes] = useState(item.notes ?? "");
  const [pending, startTransition] = useTransition();
  return (
    <li className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <a
        href={item.jobs.apply_url}
        target="_blank"
        rel="noreferrer"
        className="font-medium hover:underline"
      >
        {item.jobs.title} <ExternalLink size={12} className="inline" />
      </a>
      <p className="text-muted-foreground">{item.jobs.company_name}</p>
      <Link href={`/applications/${item.id}`} className="text-xs underline">
        CV for this job
      </Link>
      {item.applied_at ? (
        <p className="text-muted-foreground text-xs">
          Applied {new Date(item.applied_at).toLocaleDateString()}
        </p>
      ) : null}
      <Select
        aria-label={`Status of ${item.jobs.title}`}
        value={item.status}
        disabled={pending}
        className="h-8 text-xs"
        onChange={(e) => startTransition(() => moveApplication(item.id, e.target.value))}
      >
        {COLUMNS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
        <option value="withdrawn">Withdrawn</option>
      </Select>
      <Textarea
        aria-label="Notes"
        placeholder="Notes"
        className="min-h-14 text-xs"
        value={notes}
        maxLength={2000}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() =>
          notes !== (item.notes ?? "") && startTransition(() => saveNotes(item.id, notes))
        }
      />
    </li>
  );
}

export function Board({ items }: { items: BoardItem[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="grid min-w-[1050px] grid-cols-7 gap-3">
        {COLUMNS.map(([status, label]) => {
          const col = items.filter((i) => i.status === status);
          return (
            <section
              key={status}
              aria-label={label}
              className="bg-muted/50 flex flex-col gap-2 rounded-xl p-2"
            >
              <h2 className="flex justify-between px-1 text-sm font-medium">
                {label} <span className="text-muted-foreground">{col.length}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {col.map((item) => (
                  <Card key={item.id} item={item} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
