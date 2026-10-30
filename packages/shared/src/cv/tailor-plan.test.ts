import { describe, expect, it } from "vitest";
import { resumeSchema } from "../resume";
import { checkTailoredCv } from "./truth";
import { applyPlan, numberedCv, ruleTailor, tailorPlanSchema } from "./tailor-plan";

const cv = resumeSchema.parse({
  basics: { name: "Sam Tester", label: "Backend Engineer", summary: "Backend engineer." },
  work: [
    {
      name: "Brightbank",
      position: "Senior Backend Engineer",
      startDate: "2021-01",
      highlights: [
        "Ran the office book club",
        "Built payment APIs in PHP and Symfony",
        "Moved 6 services to Azure",
        "Cut p95 latency from 900 ms to 250 ms",
        "Mentored 3 juniors",
        "Wrote Terraform for every environment",
        "Organised the team offsite",
      ],
    },
    {
      name: "Shopline",
      position: "Developer",
      startDate: "2018-01",
      endDate: "2020-12",
      highlights: ["Built the Laravel order service", "Fixed printers", "Added Redis caching"],
    },
    { name: "Northgate", position: "Junior Developer", startDate: "2017-01", endDate: "2017-12" },
  ],
  skills: [
    { name: "Languages", keywords: ["PHP", "Python", "SQL"] },
    { name: "Frameworks", keywords: ["Symfony", "Laravel", "Django"] },
    { name: "Cloud", keywords: ["Azure", "AWS", "Terraform", "Docker"] },
    { name: "Other", keywords: ["Figma", "Excel"] },
  ],
  projects: [
    { name: "Bird app", description: "A hobby app in Swift" },
    { name: "queue-watch", description: "A PHP queue monitor" },
  ],
});

const job = {
  title: "Senior PHP Engineer",
  text: "We build payments in PHP and Symfony on Azure. Terraform a plus.",
};

describe("tailoring plan", () => {
  it("numbers jobs, bullets and projects for the AI", () => {
    const text = numberedCv(cv);
    expect(text).toContain("J0. Senior Backend Engineer at Brightbank");
    expect(text).toContain("B3. Cut p95 latency");
    expect(text).toContain("P1. queue-watch");
  });

  it("builds the CV from the plan, using only what the CV has", () => {
    const plan = tailorPlanSchema.parse({
      headline: "Senior PHP Engineer",
      summary: "Senior backend engineer building PHP payment APIs on Azure.",
      skills: [
        {
          name: "Core",
          keywords: ["php", "Symfony", "Kubernetes", "Laravel", "SQL", "Azure", "Terraform"],
        },
        { name: "More", keywords: ["Docker", "Python", "AWS", "PHP"] },
      ],
      work: [
        {
          job: 0,
          bullets: [
            { from: 1, text: "Built PHP and Symfony payment APIs" },
            { from: 99, text: "Invented bullet" },
            { from: 3, text: "Cut p95 latency from 900 ms to 250 ms" },
            { from: 1, text: "Same bullet twice" },
          ],
        },
      ],
      projects: [1, 1, 7],
    });
    const out = applyPlan(cv, plan, job.title, job.text);
    expect(out.basics.label).toBe("Senior PHP Engineer");
    // The CV's own spelling, no Kubernetes (not in the CV), PHP only once.
    expect(out.skills.flatMap((g) => g.keywords)).toEqual([
      "PHP", "Symfony", "Laravel", "SQL", "Azure", "Terraform", "Docker", "Python", "AWS",
    ]); // prettier-ignore
    expect(out.work[0]!.highlights).toEqual([
      "Built PHP and Symfony payment APIs",
      "Cut p95 latency from 900 ms to 250 ms",
    ]);
    // Every job stays: one the plan skipped gets its most relevant bullets by rule.
    expect(out.work.map((w) => w.name)).toEqual(["Brightbank", "Shopline", "Northgate"]);
    expect(out.work[1]!.highlights).toContain("Built the Laravel order service");
    expect(out.projects.map((p) => p.name)).toEqual(["queue-watch"]);
  });

  it("keeps every fact check: a reworded bullet with a new number is removed", () => {
    const plan = tailorPlanSchema.parse({
      skills: [{ name: "All", keywords: cv.skills.flatMap((g) => g.keywords) }],
      work: [{ job: 0, bullets: [{ from: 2, text: "Moved 60 services to Azure" }] }],
    });
    const { resume, report } = checkTailoredCv(cv, applyPlan(cv, plan, job.title, job.text));
    expect(resume.work[0]!.highlights).toEqual([]);
    expect(report.removed.some((r) => r.item.includes("60 services"))).toBe(true);
  });

  it("without an AI, puts the job's technologies first and trims the weakest bullets", () => {
    const out = ruleTailor(cv, job.title, job.text);
    expect(out.skills[0]!.name).toBe("Languages");
    expect(out.skills[0]!.keywords[0]).toBe("PHP");
    expect(out.skills.at(-1)!.name).toBe("Other");
    const first = out.work[0]!.highlights;
    expect(first).toHaveLength(5);
    expect(first).toContain("Built payment APIs in PHP and Symfony");
    expect(first).not.toContain("Organised the team offsite");
    expect(out.projects[0]!.name).toBe("queue-watch");
  });

  it("a headline with a technology the CV lacks is put back", () => {
    const plan = tailorPlanSchema.parse({ headline: "Senior Go Engineer, Kubernetes" });
    const { resume } = checkTailoredCv(cv, applyPlan(cv, plan, job.title, job.text));
    expect(resume.basics.label).toBe("Backend Engineer");
  });
});
