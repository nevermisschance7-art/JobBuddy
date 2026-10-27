import "server-only";
import type { Resume } from "@jobbuddy/shared";
import { personalInfoFor, routerFor } from "@/lib/ai/router";
import type { createClient } from "@/lib/supabase/server";
import { tailorWithRouter, type TailorJob, type TailorResult } from "./tailor-core";

export { jobText, type TailorJob, type TailorResult } from "./tailor-core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** AI picks, orders and rewords; the code truth checker then removes anything not in the CV. */
export async function tailorResume(
  supabase: Supabase,
  userId: string,
  source: Resume,
  job: TailorJob,
): Promise<TailorResult> {
  return tailorWithRouter(
    routerFor(supabase),
    userId,
    source,
    job,
    await personalInfoFor(supabase, userId),
  );
}
