import "server-only";
import type { Resume } from "@jobbuddy/shared";
import { AllProvidersFailedError, LlmOutputError } from "@jobbuddy/shared/llm";
import { routerFor } from "@/lib/ai/router";
import type { createClient } from "@/lib/supabase/server";
import { readCvWithRouter } from "./read-core";
import { cvTextToResume } from "./to-resume";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type CvReadResult = { resume: Resume; usedAi: boolean; note?: string };

/**
 * Reads a CV with the AI router. Falls back to the simple rule-based reader when no AI
 * is available, so upload never fails just because a key is missing or out of quota.
 */
export async function readCv(
  supabase: Supabase,
  userId: string,
  cvText: string,
): Promise<CvReadResult> {
  // Contact details found by the simple reader are hidden from the model and restored after.
  const basic = cvTextToResume(cvText);
  try {
    const resume = await readCvWithRouter(routerFor(supabase), userId, cvText, {
      name: basic.basics.name,
      email: basic.basics.email,
      phone: basic.basics.phone,
    });
    return { resume, usedAi: true };
  } catch (e) {
    if (e instanceof AllProvidersFailedError) {
      return {
        resume: basic,
        usedAi: false,
        note: "I couldn't reach an AI, so I only read the basics. Add a free Gemini key in the AI step to read the rest, or fill it in below.",
      };
    }
    if (e instanceof LlmOutputError) {
      console.error("cv_to_resume output invalid", e.message);
      return {
        resume: basic,
        usedAi: false,
        note: "The AI's reading didn't look right, so I only kept the basics. Fill in the rest below.",
      };
    }
    throw e;
  }
}
