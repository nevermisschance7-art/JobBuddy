import { FixedAnswersForm } from "@/components/forms/fixed-answers-form";
import { MascotSays } from "@/components/mascot";
import { loadFixedAnswers } from "@/lib/loaders";
import { nextStep } from "../steps";

export default async function AnswersStep() {
  const values = await loadFixedAnswers();

  return (
    <>
      <MascotSays mood="comforting">
        These are the touchy questions forms always ask. I&apos;ll copy your answers exactly and
        never make them up. The AI never even sees them.
      </MascotSays>
      <h1 className="text-2xl font-semibold">Fixed answers</h1>
      <FixedAnswersForm values={values} next={nextStep("/onboarding/answers")} />
    </>
  );
}
