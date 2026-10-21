"use client";

import type { Resume } from "@jobbuddy/shared";
import { Plus, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { NextField } from "@/components/next-field";
import { Button } from "@/components/ui/button";
import { Card, Field, FormMessage, Input, Textarea } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { confirmResume } from "@/lib/actions/onboarding";

// Loose editing shape: everything is a string while typing; the server cleans and validates.
type Row = Record<string, string>;
type Draft = {
  basics: Row;
  profiles: Row[];
  work: Row[];
  education: Row[];
  skills: Row[];
  projects: Row[];
};

type FieldDef = { key: string; label: string; multiline?: boolean; placeholder?: string };

const SECTIONS: { key: keyof Omit<Draft, "basics">; title: string; fields: FieldDef[] }[] = [
  {
    key: "work",
    title: "Experience",
    fields: [
      { key: "position", label: "Job title" },
      { key: "name", label: "Company" },
      { key: "location", label: "Location" },
      { key: "startDate", label: "Start", placeholder: "YYYY-MM" },
      { key: "endDate", label: "End (empty if current)", placeholder: "YYYY-MM" },
      { key: "highlights", label: "What you did, one per line", multiline: true },
    ],
  },
  {
    key: "education",
    title: "Education",
    fields: [
      { key: "institution", label: "School" },
      { key: "studyType", label: "Degree" },
      { key: "area", label: "Subject" },
      { key: "startDate", label: "Start", placeholder: "YYYY" },
      { key: "endDate", label: "End", placeholder: "YYYY" },
    ],
  },
  {
    key: "skills",
    title: "Skills",
    fields: [
      { key: "name", label: "Group", placeholder: "e.g. Backend" },
      { key: "keywords", label: "Skills, comma separated", placeholder: "Python, Go, PostgreSQL" },
    ],
  },
  {
    key: "projects",
    title: "Projects",
    fields: [
      { key: "name", label: "Name" },
      { key: "url", label: "Link" },
      { key: "description", label: "Short description", multiline: true },
      { key: "keywords", label: "Tech, comma separated" },
    ],
  },
  {
    key: "profiles",
    title: "Links",
    fields: [
      { key: "network", label: "Site", placeholder: "LinkedIn" },
      { key: "url", label: "URL" },
    ],
  },
];

const str = (v: unknown) => (typeof v === "string" ? v : "");
const joinList = (v: unknown, sep: string) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").join(sep) : "";

function toDraft(r: Resume): Draft {
  const rows = (items: object[] | undefined, map: (i: Record<string, unknown>) => Row) =>
    (items ?? []).map((i) => map(i as Record<string, unknown>));
  return {
    basics: {
      name: str(r.basics?.name),
      label: str(r.basics?.label),
      email: str(r.basics?.email),
      phone: str(r.basics?.phone),
      city: str(r.basics?.location?.city),
      countryCode: str(r.basics?.location?.countryCode),
      summary: str(r.basics?.summary),
    },
    profiles: rows(r.basics?.profiles, (p) => ({ network: str(p.network), url: str(p.url) })),
    work: rows(r.work, (w) => ({
      position: str(w.position),
      name: str(w.name),
      location: str(w.location),
      startDate: str(w.startDate),
      endDate: str(w.endDate),
      highlights: joinList(w.highlights, "\n"),
    })),
    education: rows(r.education, (e) => ({
      institution: str(e.institution),
      studyType: str(e.studyType),
      area: str(e.area),
      startDate: str(e.startDate),
      endDate: str(e.endDate),
    })),
    skills: rows(r.skills, (s) => ({ name: str(s.name), keywords: joinList(s.keywords, ", ") })),
    projects: rows(r.projects, (p) => ({
      name: str(p.name),
      url: str(p.url),
      description: str(p.description),
      keywords: joinList(p.keywords, ", "),
    })),
  };
}

const lines = (v: string | undefined) =>
  (v ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const commas = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function fromDraft(d: Draft, original: Resume): Resume {
  return {
    ...original,
    basics: {
      ...original.basics,
      name: d.basics.name ?? "",
      label: d.basics.label,
      email: d.basics.email,
      phone: d.basics.phone,
      summary: d.basics.summary,
      location: {
        ...original.basics?.location,
        city: d.basics.city,
        countryCode: d.basics.countryCode?.toUpperCase(),
      },
      profiles: d.profiles.map((p) => ({ network: p.network ?? "", url: p.url ?? "" })),
    },
    work: d.work.map((w) => ({
      position: w.position ?? "",
      name: w.name ?? "",
      location: w.location,
      startDate: w.startDate,
      endDate: w.endDate,
      highlights: lines(w.highlights),
    })),
    education: d.education.map((e) => ({
      institution: e.institution ?? "",
      studyType: e.studyType,
      area: e.area,
      startDate: e.startDate,
      endDate: e.endDate,
    })),
    skills: d.skills.map((s) => ({ name: s.name ?? "", keywords: commas(s.keywords) })),
    projects: d.projects.map((p) => ({
      name: p.name ?? "",
      url: p.url,
      description: p.description,
      highlights: [],
      keywords: commas(p.keywords),
    })),
  };
}

export function ResumeEditor({
  cvId,
  resume,
  confirmed,
  next,
}: {
  cvId: string;
  resume: Resume;
  confirmed: boolean;
  next?: string;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(resume));
  const [state, action, pending] = useActionState(confirmResume, initialState);

  const setBasic = (key: string, value: string) =>
    setDraft((d) => ({ ...d, basics: { ...d.basics, [key]: value } }));
  const setRow = (section: keyof Omit<Draft, "basics">, i: number, key: string, value: string) =>
    setDraft((d) => ({
      ...d,
      [section]: d[section].map((row, j) => (j === i ? { ...row, [key]: value } : row)),
    }));
  const addRow = (section: keyof Omit<Draft, "basics">) =>
    setDraft((d) => ({ ...d, [section]: [...d[section], {}] }));
  const removeRow = (section: keyof Omit<Draft, "basics">, i: number) =>
    setDraft((d) => ({ ...d, [section]: d[section].filter((_, j) => j !== i) }));

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="cv_id" value={cvId} />
      <input type="hidden" name="resume_json" value={JSON.stringify(fromDraft(draft, resume))} />
      <NextField next={next} />

      <Card className="grid gap-4 sm:grid-cols-2">
        <h2 className="text-lg font-semibold sm:col-span-2">About you</h2>
        {(
          [
            ["name", "Full name"],
            ["label", "Headline", "e.g. Backend Engineer"],
            ["email", "Email"],
            ["phone", "Phone"],
            ["city", "City"],
            ["countryCode", "Country code", "e.g. GB"],
          ] as const
        ).map(([key, label, placeholder]) => (
          <Field key={key} label={label} htmlFor={`basics-${key}`}>
            <Input
              id={`basics-${key}`}
              value={draft.basics[key] ?? ""}
              placeholder={placeholder}
              onChange={(e) => setBasic(key, e.target.value)}
            />
          </Field>
        ))}
        <div className="sm:col-span-2">
          <Field label="Summary" htmlFor="basics-summary">
            <Textarea
              id="basics-summary"
              value={draft.basics.summary ?? ""}
              onChange={(e) => setBasic("summary", e.target.value)}
            />
          </Field>
        </div>
      </Card>

      {SECTIONS.map((section) => (
        <Card key={section.key} className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{section.title}</h2>
          {draft[section.key].map((row, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
              {section.fields.map((f) => {
                const id = `${section.key}-${i}-${f.key}`;
                return (
                  <div key={f.key} className={f.multiline ? "sm:col-span-2" : undefined}>
                    <Field label={f.label} htmlFor={id}>
                      {f.multiline ? (
                        <Textarea
                          id={id}
                          value={row[f.key] ?? ""}
                          onChange={(e) => setRow(section.key, i, f.key, e.target.value)}
                        />
                      ) : (
                        <Input
                          id={id}
                          value={row[f.key] ?? ""}
                          placeholder={f.placeholder}
                          onChange={(e) => setRow(section.key, i, f.key, e.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                );
              })}
              <div className="sm:col-span-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(section.key, i)}
                >
                  <Trash2 size={14} /> Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => addRow(section.key)}
          >
            <Plus size={14} /> Add {section.title.toLowerCase()}
          </Button>
        </Card>
      ))}

      <FormMessage error={state.error} ok={state.message} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving..." : confirmed ? "Save changes" : "This is right, confirm my CV"}
      </Button>
    </form>
  );
}
