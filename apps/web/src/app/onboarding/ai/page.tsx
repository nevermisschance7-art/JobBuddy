import Link from "next/link";
import { AiKeysForm } from "@/components/forms/ai-keys-form";
import { MascotSays } from "@/components/mascot";
import { loadKeyStatuses } from "@/lib/loaders";
import { nextStep } from "../steps";

export default async function AiStep() {
  const statuses = await loadKeyStatuses();
  const hasGemini = statuses.some((s) => s.provider === "gemini" && s.keys.length > 0);
  const next = nextStep("/onboarding/ai");

  return (
    <>
      <MascotSays mood="thinking">
        First, a free AI key. I use it to read your CV, tailor it and draft answers. It runs on your
        own free key, so it costs nothing.
      </MascotSays>
      <h1 className="text-2xl font-semibold">Your AI key</h1>
      <AiKeysForm statuses={statuses} />
      <Link
        href={next}
        className="bg-primary text-primary-foreground self-end rounded-md px-6 py-2.5 text-sm font-medium"
      >
        {hasGemini ? "Continue" : "Skip for now"}
      </Link>
    </>
  );
}
