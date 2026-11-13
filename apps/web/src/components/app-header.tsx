import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { NavLinks } from "./nav-links";

/** wide: the job board, which uses the whole screen. */
export function AppHeader({ username, wide }: { username: string | null; wide?: boolean }) {
  return (
    <header className="border-border bg-card/95 sticky top-0 z-30 border-b backdrop-blur">
      <div
        className={`mx-auto flex items-center justify-between gap-4 px-4 py-2.5 sm:px-6 ${wide ? "max-w-[1440px]" : "max-w-6xl"}`}
      >
        <Link href="/app" className="flex items-center gap-2 font-semibold">
          <Mascot size={30} /> <span className="hidden sm:inline">JobBuddy</span>
        </Link>
        <nav className="scroll-x flex items-center gap-0.5 text-sm">
          <NavLinks />
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" title={username ?? undefined}>
              Sign out
            </Button>
          </form>
        </nav>
      </div>
    </header>
  );
}
