"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ComboOption = { value: string; label: string };

/**
 * A dropdown you can type in: click (or focus and type), filter by any part of the label,
 * pick with the arrow keys and Enter, close with Escape. Used for every dropdown on the site.
 * In a form, `name` adds a hidden input with the chosen value.
 */
export function Combobox({
  options,
  value,
  defaultValue,
  onChange,
  name,
  id,
  placeholder = "Choose",
  ariaLabel,
  disabled,
  className,
}: {
  options: ComboOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const current = value ?? own;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === current);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // Labels starting with the text first, then ones containing it anywhere.
    const starts = options.filter((o) => o.label.toLowerCase().startsWith(q));
    const contains = options.filter(
      (o) => !o.label.toLowerCase().startsWith(q) && o.label.toLowerCase().includes(q),
    );
    return [...starts, ...contains];
  }, [options, query]);

  // Close when clicking anywhere else.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // Opening: focus the search box and show the chosen option.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const at = Math.max(
      0,
      options.findIndex((o) => o.value === current),
    );
    setActive(at);
    search.current?.focus();
    requestAnimationFrame(() => list.current?.children[at]?.scrollIntoView({ block: "nearest" }));
    // Only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (option: ComboOption | undefined) => {
    if (!option) return;
    if (value === undefined) setOwn(option.value);
    onChange?.(option.value);
    setOpen(false);
  };

  const move = (by: number) => {
    const next = Math.min(Math.max(active + by, 0), shown.length - 1);
    setActive(next);
    list.current?.children[next]?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          // Typing on the closed dropdown opens it with that text.
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            setOpen(true);
            requestAnimationFrame(() => setQuery(e.key));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "border-border bg-background flex h-10 w-full items-center gap-2 rounded-md border px-3 text-left text-sm",
          "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60",
        )}
      >
        <span className={cn("flex-1 truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={16} className="text-muted-foreground shrink-0" />
      </button>
      {open ? (
        <div className="border-border bg-card absolute left-0 right-0 z-50 mt-1 min-w-48 overflow-hidden rounded-lg border shadow-lg">
          <div className="border-border flex items-center gap-2 border-b px-3">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              ref={search}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  move(1);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  move(-1);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  choose(shown[active]);
                } else if (e.key === "Escape") {
                  setOpen(false);
                } else if (e.key === "Tab") {
                  setOpen(false);
                }
              }}
              placeholder="Type to search"
              aria-controls={listId}
              aria-label="Search the options"
              className="h-9 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <ul ref={list} id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <li className="text-muted-foreground px-3 py-2 text-sm">No match</li>
            ) : (
              shown.map((o, i) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === current}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(o);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                    i === active && "bg-muted",
                  )}
                >
                  <Check
                    size={14}
                    className={cn("shrink-0", o.value === current ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{o.label}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
