// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { FillData } from "../types";
import { collectFields, fillForm, type FieldKind } from "./form";

// Real application forms saved by the "Probe forms" workflow (scripts removed). The form code
// must keep finding the basics on each of them.

// Tests run from the extension folder.
const dir = join(process.cwd(), "test/fixtures/real/");
const load = (name: string) => {
  const html = readFileSync(`${dir}${name}`, "utf8");
  document.documentElement.innerHTML = html
    .replace(/^<!doctype html>/i, "")
    .replace(/^<html[^>]*>|<\/html>$/g, "");
};

const data: FillData = {
  applicationId: "a",
  status: "prepared",
  profile: {
    fullName: "Sam Tester",
    firstName: "Sam",
    lastName: "Tester",
    email: "sam@example.com",
    phone: "+44 7700 900123",
    city: "Manchester",
    countryCode: "GB",
    linkedin: "https://www.linkedin.com/in/sam",
    github: "https://github.com/sam",
    website: "https://sam.dev",
    country: "United Kingdom",
    currentCompany: "Brightbank",
    currentTitle: "Backend Engineer",
    headline: "Backend Engineer",
    summary: "Backend engineer with 6 years of Python.",
  },
  fixedAnswers: { demographics: "I prefer not to say", location: "Manchester, United Kingdom" },
  answers: [],
  cv: null,
};

const kinds = () => new Set(collectFields(document).map((f) => f.kind));
const expectKinds = (wanted: FieldKind[]) => {
  const found = kinds();
  for (const k of wanted) expect(found, `missing ${k}`).toContain(k);
};

describe("real forms", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "";
  });

  it("Greenhouse (job-boards, react-select dropdowns)", () => {
    load("greenhouse-3.html");
    expectKinds(["first_name", "last_name", "email", "phone", "resume", "country"]);
    const fields = collectFields(document);
    const gender = fields.find((f) => f.label === "Gender");
    expect(gender?.combobox).toBe(true);
  });

  it("Lever (application-question blocks, EEO selects)", () => {
    for (const name of ["lever-1.html", "lever-3.html"]) {
      load(name);
      expectKinds(["full_name", "email", "phone", "resume", "current_company"]);
    }
    load("lever-1.html");
    const report = fillForm(collectFields(document), data);
    // EEO selects get "prefer not to say" in the form's own words.
    const missed = report.missed.map((f) => f.label);
    expect(missed).not.toContain("What gender do you identify as?");
    expect(missed).not.toContain("What is your location?");
  });

  it("Workable (data-ui hooks, Yes/No buttons)", () => {
    for (const name of ["workable-1.html", "workable-2.html", "workable-3.html"]) {
      load(name);
      expectKinds(["first_name", "last_name", "email", "phone", "resume"]);
      expect(collectFields(document).some((f) => f.choices)).toBe(true);
    }
    load("workable-1.html");
    expectKinds(["headline", "summary"]);
  });

  it("JOIN forms linked from Arbeitnow", () => {
    load("arbeitnow-2.html");
    expectKinds(["first_name", "last_name", "email", "resume"]);
  });
});

describe("every saved real form", () => {
  const index = JSON.parse(readFileSync(`${dir}index.json`, "utf8")) as {
    fixture: string;
    fields: number;
  }[];

  it.each(index.map((x) => [x.fixture, x.fields] as const))(
    "%s: reads and fills without errors",
    (name, fields) => {
      load(name);
      const found = collectFields(document);
      // Never fewer fields than the probe found in the live page (minus a little slack).
      expect(found.length).toBeGreaterThanOrEqual(Math.max(0, fields - 2));
      expect(() => fillForm(found, data)).not.toThrow();
    },
  );
});
