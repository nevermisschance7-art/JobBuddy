"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  ["/app", "Jobs", ""],
  ["/applications", "Applications", ""],
  ["/usage", "Usage", "hidden sm:inline-flex"],
  ["/settings", "Settings", ""],
] as const;

/** Header links; the current page is highlighted. */
export function NavLinks() {
  const path = usePathname();
  return (
    <>
      {LINKS.map(([href, label, extra]) => {
        const active = path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex rounded-md px-3 py-2",
              active ? "bg-brand-soft text-primary font-semibold" : "hover:bg-muted",
              extra,
            )}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
