import { ProgressDots } from "./progress-dots";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6">
      <ProgressDots />
      {children}
    </main>
  );
}
