import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { MascotSays } from "@/components/mascot";
import { loadProfile } from "@/lib/data";

export default async function Dashboard() {
  const { profile } = await loadProfile();
  if (!profile?.onboarded_at) redirect("/onboarding");

  return (
    <>
      <AppHeader username={profile.username} />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
        <MascotSays mood="sleepy">
          No jobs yet. I&apos;m still building my job hunting skills. Check back soon.
        </MascotSays>
      </main>
    </>
  );
}
