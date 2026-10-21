"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { STEPS } from "./steps";

export function ProgressDots() {
  const path = usePathname();
  const current = Math.max(
    0,
    STEPS.findIndex((s) => s.path === path),
  );

  return (
    <nav aria-label="Onboarding progress" className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <Link
          key={s.path}
          href={s.path}
          aria-label={s.label}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "h-2.5 rounded-full transition-all",
            i === current ? "w-6 bg-foreground" : "w-2.5",
            i < current ? "bg-foreground/60" : i > current ? "bg-muted-foreground/30" : "",
          )}
        />
      ))}
      <span className="ml-2 text-xs text-muted-foreground">
        Step {current + 1} of {STEPS.length}: {STEPS[current]?.label}
      </span>
    </nav>
  );
}
