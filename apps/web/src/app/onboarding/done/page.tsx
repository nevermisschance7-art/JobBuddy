import { MascotSays } from "@/components/mascot";
import { Card } from "@/components/ui/field";
import { finishOnboarding } from "@/lib/actions/onboarding";
import { loadLatestCv } from "@/lib/loaders";
import { StartButton } from "../start-button";

export default async function DoneStep() {
  const cv = await loadLatestCv();

  return (
    <>
      <MascotSays mood="celebrating">
        I&apos;m off to find jobs. First results within about 2 hours.
      </MascotSays>
      <Card className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">All set</h1>
        {!cv?.confirmed ? (
          <p className="text-destructive text-sm">
            Your CV isn&apos;t confirmed yet. I can&apos;t match jobs until it is. You can do it
            later in Settings.
          </p>
        ) : null}
        <p className="text-muted-foreground text-sm">
          You can change any of this later in Settings.
        </p>
        <form action={finishOnboarding}>
          <StartButton label="Go to my dashboard" />
        </form>
      </Card>
    </>
  );
}
