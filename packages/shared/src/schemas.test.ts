import { describe, expect, it } from "vitest";
import { jobSchema, matchBreakdownSchema, resumeSchema } from "./index";

const baseJob = {
  id: "8d3c6f0e-6a4b-4f3e-9a51-2a8f1f0c1a11",
  source: "greenhouse",
  externalId: "123",
  canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
  applyUrl: "https://boards.greenhouse.io/acme/jobs/123",
  title: "Backend Engineer",
  companyId: null,
  companyName: "Acme",
  locations: [{ raw: "Berlin, Germany", city: "Berlin", countryCode: "DE" }],
  countries: ["DE"],
  remoteType: "hybrid",
  employmentType: "full_time",
  seniority: "mid",
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  descriptionText: "Build APIs.",
  firstSeenAt: "2026-10-20T10:00:00Z",
  lastSeenAt: "2026-10-21T10:00:00Z",
  closedAt: null,
};

describe("jobSchema", () => {
  it("accepts a known posting date from the source", () => {
    const r = jobSchema.safeParse({
      ...baseJob,
      postedAt: "2026-10-19T08:00:00Z",
      dateSource: "source_field",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an unknown posting date", () => {
    const r = jobSchema.safeParse({ ...baseJob, postedAt: null, dateSource: "unknown" });
    expect(r.success).toBe(true);
  });

  it("rejects a posting date without a source field", () => {
    const r = jobSchema.safeParse({
      ...baseJob,
      postedAt: "2026-10-21T10:00:00Z",
      dateSource: "unknown",
    });
    expect(r.success).toBe(false);
  });
});

describe("resumeSchema", () => {
  it("fills defaults for missing sections", () => {
    const r = resumeSchema.parse({ basics: { name: "Sam" } });
    expect(r.work).toEqual([]);
    expect(r.skills).toEqual([]);
  });

  it("rejects free-text dates", () => {
    const r = resumeSchema.safeParse({
      basics: { name: "Sam" },
      work: [{ name: "Acme", position: "Dev", startDate: "March 2021" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("matchBreakdownSchema", () => {
  it("caps each part at its weight", () => {
    const r = matchBreakdownSchema.safeParse({
      technical: { points: 36, reason: "" },
      seniority: { points: 0, reason: "" },
      eligibility: { points: 0, reason: "" },
      remote: { points: 0, reason: "" },
      freshness: { points: 0, reason: "" },
      compensation: { points: 0, reason: "" },
    });
    expect(r.success).toBe(false);
  });
});
