import { MascotSays } from "@/components/mascot";
import { Card } from "@/components/ui/field";
import { startOnboarding } from "@/lib/actions/onboarding";
import { loadProfile } from "@/lib/data";
import { TimeZoneField } from "./time-zone-field";
import { StartButton } from "./start-button";

export default async function Welcome() {
  const { profile } = await loadProfile();

  return (
    <>
      <MascotSays mood="happy">
        Hi {profile?.display_name ?? "there"}, I&apos;m Byte. I&apos;ll help you find jobs without
        the grind.
      </MascotSays>
      <Card className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Here&apos;s what I do</h1>
        <ul className="list-disc space-y-2 pl-5">
          <li>I find recent jobs that fit your CV and your rules, every couple of hours.</li>
          <li>I tailor your CV and draft short answers, using only facts you gave me.</li>
          <li>I fill in the forms. You always check and press Submit yourself.</li>
        </ul>
        <form action={startOnboarding}>
          <TimeZoneField />
          <StartButton />
        </form>
      </Card>
    </>
  );
}
