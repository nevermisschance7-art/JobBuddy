import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";

export function AppHeader({ username }: { username: string | null }) {
  return (
    <header className="border-border border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/app" className="flex items-center gap-2 font-semibold">
          <Mascot size={32} /> JobBuddy
        </Link>
        <nav className="flex items-center gap-0.5 overflow-x-auto text-sm">
          <Link href="/app" className="hover:bg-muted rounded-md px-3 py-2">
            Jobs
          </Link>
          <Link href="/applications" className="hover:bg-muted rounded-md px-3 py-2">
            Applications
          </Link>
          <Link href="/usage" className="hover:bg-muted hidden rounded-md px-3 py-2 sm:inline">
            Usage
          </Link>
          <Link href="/settings" className="hover:bg-muted rounded-md px-3 py-2">
            Settings
          </Link>
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
