"use client";

import type { Database } from "@jobbuddy/shared";
import { useActionState, useState } from "react";
import { NextField } from "@/components/next-field";
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import { Card, Field, FormMessage, Input, RequiredLegend, Select } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { saveFilters } from "@/lib/actions/onboarding";
import { COUNTRY_OPTIONS, CURRENCIES } from "@/lib/countries";

type Filters = Database["public"]["Tables"]["filters"]["Row"];

function Checks({
  name,
  options,
  checked,
}: {
  name: string;
  options: [string, string][];
  checked: string[];
}) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {options.map(([value, label]) => (
        <label key={value} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={name}
            value={value}
            defaultChecked={checked.includes(value)}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

export function FiltersForm({
  filters,
  minScore,
  next,
}: {
  filters: Filters;
  minScore: number;
  next?: string;
}) {
  const [state, action, pending] = useActionState(saveFilters, initialState);
  const [score, setScore] = useState(minScore);

  return (
    <form action={action} className="flex flex-col gap-6">
      <NextField next={next} />
      <RequiredLegend />

      <Card className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold">Where you can work</h2>
        <Field
          label="Countries I can work in"
          required
          htmlFor="countries"
          hint="Type a country and press Enter. Remote jobs open to these countries count too."
        >
          <TagInput
            id="countries"
            name="countries_allowed"
            initial={filters.countries_allowed}
            options={COUNTRY_OPTIONS}
            placeholder="e.g. United Kingdom"
          />
        </Field>
        <Field
          label="Also show remote jobs limited to these countries"
          htmlFor="remote-extra"
          hint='For example United States, if you would work remotely for a US company as a contractor. These jobs are marked "Potential restriction".'
        >
          <TagInput
            id="remote-extra"
            name="remote_extra_countries"
            initial={filters.remote_extra_countries}
            options={COUNTRY_OPTIONS}
            placeholder="e.g. United States"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="needs_sponsorship"
            defaultChecked={filters.needs_sponsorship}
          />
          I need visa sponsorship
        </label>
      </Card>

      <Card className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold">How you want to work</h2>
        <Field label="Work style" required>
          <Checks
            name="remote_types"
            options={[
              ["remote", "Remote"],
              ["hybrid", "Hybrid"],
              ["onsite", "On-site"],
            ]}
            checked={filters.remote_types}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Max office days a week" htmlFor="office-days">
            <Input
              id="office-days"
              name="hybrid_max_office_days"
              type="number"
              min={0}
              max={5}
              defaultValue={filters.hybrid_max_office_days ?? ""}
            />
          </Field>
          <Field label="Home city" htmlFor="home">
            <Input id="home" name="home_location" defaultValue={filters.home_location ?? ""} />
          </Field>
          <Field label="Max commute (km)" htmlFor="commute">
            <Input
              id="commute"
              name="max_commute_km"
              type="number"
              min={0}
              max={500}
              defaultValue={filters.max_commute_km ?? ""}
            />
          </Field>
        </div>
        <Field label="Job type" required>
          <Checks
            name="employment_types"
            options={[
              ["full_time", "Full-time"],
              ["part_time", "Part-time"],
              ["contract", "Contract"],
              ["temporary", "Temporary"],
            ]}
            checked={filters.employment_types}
          />
        </Field>
        <Field label="Seniority" hint="Leave all empty to see every level.">
          <Checks
            name="seniority_levels"
            options={[
              ["junior", "Junior"],
              ["mid", "Mid"],
              ["senior", "Senior"],
              ["lead", "Lead"],
              ["principal", "Principal"],
            ]}
            checked={filters.seniority_levels}
          />
        </Field>
      </Card>

      <Card className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold">Skills and companies</h2>
        <Field
          label="Must-have skills"
          htmlFor="must"
          hint="Jobs score higher when they ask for these."
        >
          <TagInput id="must" name="must_have_skills" initial={filters.must_have_skills} />
        </Field>
        <Field
          label="Skip jobs that need"
          htmlFor="excl-skills"
          hint="e.g. PHP, if you never want PHP jobs."
        >
          <TagInput id="excl-skills" name="excluded_skills" initial={filters.excluded_skills} />
        </Field>
        <Field label="Companies to skip" htmlFor="excl-co">
          <TagInput id="excl-co" name="excluded_companies" initial={filters.excluded_companies} />
        </Field>
      </Card>

      <Card className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold">Pay and match quality</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lowest salary you'd take (yearly)" htmlFor="salary">
            <Input
              id="salary"
              name="salary_floor"
              type="number"
              min={0}
              step={1000}
              defaultValue={filters.salary_floor ?? ""}
            />
          </Field>
          <Field label="Currency" htmlFor="currency">
            <Select
              id="currency"
              name="salary_currency"
              defaultValue={filters.salary_currency ?? ""}
            >
              <option value="">Choose</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label={`Show me jobs scoring at least ${score} / 100`}
          htmlFor="min-score"
          hint="55 is a good start. Lower shows more jobs, higher shows fewer, closer ones."
        >
          <input
            id="min-score"
            name="min_score"
            type="range"
            min={0}
            max={100}
            step={5}
            value={score}
            onChange={(e) => setScore(Number(e.target.value))}
          />
        </Field>
      </Card>

      <FormMessage error={state.error} ok={state.message} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving..." : next ? "Save and continue" : "Save filters"}
      </Button>
    </form>
  );
}
