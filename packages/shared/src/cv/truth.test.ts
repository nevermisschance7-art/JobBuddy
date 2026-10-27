import { describe, expect, it } from "vitest";
import { resumeSchema, type Resume } from "../resume";
import { checkTailoredCv, numbersIn, termsIn, unsupportedIn } from "./truth";

const source: Resume = resumeSchema.parse({
  basics: { name: "Sam Tester", email: "sam@example.com", summary: "Backend developer." },
  work: [
    {
      name: "Acme",
      position: "Backend Engineer",
      startDate: "2021-03",
      endDate: "2024-01",
      highlights: [
        "Built Python APIs on AWS serving 2M requests a day",
        "Cut deploy time by 40% with Docker and GitHub Actions",
      ],
    },
  ],
  education: [{ institution: "Leeds University", area: "Computer Science", endDate: "2020" }],
  skills: [{ name: "Backend", keywords: ["Python", "PostgreSQL", "JavaScript"] }],
  projects: [{ name: "Tiny CRM", description: "A small CRM in Django", keywords: ["Django"] }],
});

const clone = (r: Resume): Resume => structuredClone(r);

describe("checkTailoredCv", () => {
  it("keeps a CV that only reorders and rewords", () => {
    const t = clone(source);
    t.basics.summary = "Python backend developer with AWS experience.";
    t.work[0]!.highlights = [
      "Cut deploy time by 40% using Docker and GitHub Actions",
      "Built Python APIs on AWS that served 2 million requests a day",
    ];
    t.skills[0]!.keywords = ["PostgreSQL", "Postgres", "Python"];
    const { resume, report } = checkTailoredCv(source, t);
    expect(report.removed).toEqual([]);
    expect(report.corrected).toEqual([]);
    expect(resume.work[0]!.highlights).toHaveLength(2);
    expect(resume.basics.summary).toContain("AWS");
  });

  it("removes an invented skill and a bullet that mentions it", () => {
    const t = clone(source);
    t.skills[0]!.keywords.push("Kubernetes", "Java");
    t.work[0]!.highlights.push("Ran Kubernetes clusters");
    const { resume, report } = checkTailoredCv(source, t);
    expect(resume.skills[0]!.keywords).toEqual(["Python", "PostgreSQL", "JavaScript"]);
    expect(resume.work[0]!.highlights).not.toContain("Ran Kubernetes clusters");
    expect(report.removed.map((r) => r.item)).toEqual(
      expect.arrayContaining(["Kubernetes", "Java", "Ran Kubernetes clusters"]),
    );
  });

  it("restores changed dates and titles", () => {
    const t = clone(source);
    t.work[0]!.startDate = "2019-01";
    t.work[0]!.position = "Senior Backend Engineer";
    const { resume, report } = checkTailoredCv(source, t);
    expect(resume.work[0]!.startDate).toBe("2021-03");
    expect(resume.work[0]!.position).toBe("Backend Engineer");
    expect(report.corrected).toHaveLength(2);
  });

  it("removes a bullet with an inflated number", () => {
    const t = clone(source);
    t.work[0]!.highlights[1] = "Cut deploy time by 70% with Docker and GitHub Actions";
    const { resume, report } = checkTailoredCv(source, t);
    expect(resume.work[0]!.highlights).toHaveLength(1);
    expect(report.removed[0]!.reason).toMatch(/70%/);
  });

  it("drops invented employers and projects, and keeps contact details from the CV", () => {
    const t = clone(source);
    t.work.push({ name: "Google", position: "Engineer", highlights: [] });
    t.projects.push({ name: "Rocket", highlights: [], keywords: [] });
    t.basics.email = "other@example.com";
    const { resume, report } = checkTailoredCv(source, t);
    expect(resume.work.map((w) => w.name)).toEqual(["Acme"]);
    expect(resume.projects.map((p) => p.name)).toEqual(["Tiny CRM"]);
    expect(resume.basics.email).toBe("sam@example.com");
    expect(report.removed).toHaveLength(2);
  });

  it("falls back to the CV summary when the AI summary invents a technology", () => {
    const t = clone(source);
    t.basics.summary = "Rust and Python developer.";
    const { resume, report } = checkTailoredCv(source, t);
    expect(resume.basics.summary).toBe("Backend developer.");
    expect(report.removed[0]!.section).toBe("Summary");
  });

  it("lists the job's technologies the CV doesn't show", () => {
    const { report } = checkTailoredCv(
      source,
      clone(source),
      "We use Python, Kafka and K8s on AWS.",
    );
    expect(report.gaps).toEqual(["kafka", "kubernetes"]);
  });
});

describe("unsupportedIn", () => {
  it("lists technologies and numbers not in the CV", () => {
    expect(unsupportedIn("Cut latency by 40% with Docker, ran Kafka for 5 teams", source)).toEqual([
      "kafka",
      "5",
    ]);
  });
});

describe("helpers", () => {
  it("matches whole words and synonyms", () => {
    expect([...termsIn("JavaScript and Postgres")].sort()).toEqual(["javascript", "postgresql"]);
    expect(termsIn("We go fast").size).toBe(0);
  });

  it("normalises numbers", () => {
    expect(numbersIn("2 million users, 60 percent, 3x, 1,200")).toEqual(
      new Set(["2m", "60%", "3x", "1200"]),
    );
  });
});
