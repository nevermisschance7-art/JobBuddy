import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// /api/extension/* authenticates with a bearer token from the Chrome extension, not cookies.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/extension|.*\\.(?:svg|png|jpg|ico)$).*)",
  ],
};
