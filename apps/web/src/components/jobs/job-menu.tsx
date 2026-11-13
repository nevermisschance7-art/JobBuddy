"use client";

import { Building2, ExternalLink, EyeOff, FileText, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** The ⋯ menu on a job: explain, full description, the employer's posting, hide. */
export function JobMenu({
  company,
  postingUrl,
  onExplain,
  onDescription,
  onPosting,
  onHide,
  onHideCompany,
  children,
}: {
  company: string;
  postingUrl: string;
  onExplain: () => void;
  onDescription: () => void;
  onPosting: () => void;
  onHide: () => void;
  onHideCompany: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const item =
    "hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] outline-none";
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        onClick={(e) => {
          // Open upwards near the bottom of the screen.
          setUp(e.currentTarget.getBoundingClientRect().bottom > window.innerHeight - 240);
          setOpen((o) => !o);
        }}
        className="text-muted-foreground hover:bg-muted hover:text-foreground grid h-8 w-8 place-items-center rounded-md"
      >
        {children}
      </button>
      {open ? (
        <div
          role="menu"
          className={`border-border bg-card absolute right-0 z-40 flex w-64 flex-col rounded-xl border p-1.5 shadow-lg ${up ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          <button
            ref={first}
            type="button"
            role="menuitem"
            className={item}
            onClick={run(onExplain)}
          >
            <Info size={15} /> Explain match
          </button>
          <button type="button" role="menuitem" className={item} onClick={run(onDescription)}>
            <FileText size={15} /> Full description
          </button>
          <a
            role="menuitem"
            href={postingUrl}
            target="_blank"
            rel="noreferrer"
            className={item}
            onClick={run(onPosting)}
          >
            <ExternalLink size={15} /> Open job posting
          </a>
          <hr className="border-border my-1" />
          <button type="button" role="menuitem" className={item} onClick={run(onHide)}>
            <EyeOff size={15} /> Not for me
            <span className="text-muted-foreground ml-auto font-mono text-[11px]">Ctrl+Z undo</span>
          </button>
          <button type="button" role="menuitem" className={item} onClick={run(onHideCompany)}>
            <Building2 size={15} /> <span className="truncate">Hide every job from {company}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
