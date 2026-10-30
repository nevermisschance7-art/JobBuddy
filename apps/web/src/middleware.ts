import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// /api/extension/* and /api/mail/* authenticate with a bearer token (Chrome extension, Gmail
// script), not cookies.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/extension|api/mail|.*\\.(?:svg|png|jpg|ico)$).*)",
  ],
};
