import { FiltersForm } from "@/components/forms/filters-form";
import { MascotSays } from "@/components/mascot";
import { loadFilters } from "@/lib/loaders";
import { nextStep } from "../steps";

export default async function FiltersStep() {
  const { filters } = await loadFilters();

  return (
    <>
      <MascotSays mood="thinking">
        Tell me what you&apos;re after. I&apos;ll hide jobs that break these rules, so you never
        waste time on them.
      </MascotSays>
      <h1 className="text-2xl font-semibold">Your filters</h1>
      <FiltersForm filters={filters} next={nextStep("/onboarding/filters")} />
    </>
  );
}
