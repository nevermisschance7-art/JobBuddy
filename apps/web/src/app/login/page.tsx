import { MascotSays } from "@/components/mascot";
import { Card } from "@/components/ui/field";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · JobBuddy" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const { disabled } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <MascotSays mood="happy">
        Hi, I&apos;m Byte. Pick a username and we&apos;ll get going.
      </MascotSays>
      {disabled ? (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm">
          This account was disabled by the team admin.
        </p>
      ) : null}
      <Card>
        <h1 className="mb-4 text-2xl font-semibold">JobBuddy</h1>
        <LoginForm />
      </Card>
      <p className="text-muted-foreground text-center text-xs">
        Anyone who knows your username can open your account, so pick one that isn&apos;t obvious.
      </p>
    </main>
  );
}
