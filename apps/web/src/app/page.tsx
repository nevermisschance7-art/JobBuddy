import { redirect } from "next/navigation";
import { loadProfile } from "@/lib/data";

export default async function Home() {
  const { profile } = await loadProfile();
  redirect(profile?.onboarded_at ? "/app" : "/onboarding");
}
