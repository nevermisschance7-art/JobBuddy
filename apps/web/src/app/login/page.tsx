import { MascotSays } from "@/components/mascot";
import { Card } from "@/components/ui/field";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · JobBuddy" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <MascotSays mood="happy">
        Hi, I&apos;m Byte. Pick a username and we&apos;ll get going.
      </MascotSays>
      <Card>
        <h1 className="mb-4 text-2xl font-semibold">JobBuddy</h1>
        <LoginForm />
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Anyone who knows your username can open your account, so pick one that isn&apos;t obvious.
      </p>
    </main>
  );
}
