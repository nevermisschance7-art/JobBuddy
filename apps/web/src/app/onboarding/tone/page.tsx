import { ToneForm } from "@/components/forms/tone-form";
import { loadProfile } from "@/lib/data";
import { nextStep } from "../steps";

export default async function ToneStep() {
  const { profile } = await loadProfile();

  return (
    <>
      <h1 className="text-2xl font-semibold">How should I talk to you?</h1>
      <ToneForm tone={profile?.tone ?? "kind"} next={nextStep("/onboarding/tone")} />
    </>
  );
}
