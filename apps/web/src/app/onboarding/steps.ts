export const STEPS = [
  { path: "/onboarding", label: "Welcome" },
  // AI key before the CV, so the CV can be read by AI right away.
  { path: "/onboarding/ai", label: "AI key" },
  { path: "/onboarding/cv", label: "Your CV" },
  { path: "/onboarding/filters", label: "Filters" },
  { path: "/onboarding/answers", label: "Fixed answers" },
  { path: "/onboarding/tone", label: "Tone" },
  { path: "/onboarding/done", label: "Done" },
] as const;

export function nextStep(path: string): string {
  const i = STEPS.findIndex((s) => s.path === path);
  return STEPS[i + 1]?.path ?? "/app";
}
