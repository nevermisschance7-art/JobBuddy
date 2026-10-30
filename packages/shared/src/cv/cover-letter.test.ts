import { describe, expect, it } from "vitest";
import { resumeSchema } from "../resume";
import { letterProblems, ruleCoverLetter, wrapLetter } from "./cover-letter";
import { unsupportedIn } from "./truth";

const cv = resumeSchema.parse({
  basics: { name: "Sam Tester", label: "Backend Engineer · Payments" },
  work: [
    {
      name: "Brightbank",
      position: "Senior Backend Engineer",
      startDate: "2019-01",
      highlights: [
        "Organised the team offsite",
        "Built payment APIs in PHP and Symfony",
        "Cut p95 latency from 900 ms to 250 ms",
      ],
    },
  ],
  skills: [
    { name: "Languages", keywords: ["PHP", "Python"] },
    { name: "Frameworks", keywords: ["Symfony", "Django"] },
  ],
});
const job = {
  title: "Senior PHP Engineer",
  company_name: "Acme",
  description_text: "PHP and Symfony payments. Kubernetes a plus.",
};

describe("cover letter", () => {
  it("writes one from the CV's own facts, for this job", () => {
    const letter = ruleCoverLetter(cv, job);
    expect(letter.startsWith("Dear Acme hiring team,")).toBe(true);
    expect(letter).toContain("Senior PHP Engineer role at Acme");
    expect(letter).toContain("PHP and Symfony");
    expect(letter).toContain("built payment APIs in PHP and Symfony");
    expect(letter.endsWith("Kind regards,\nSam Tester")).toBe(true);
    // Nothing the CV doesn't have (Kubernetes is in the job, not the CV).
    expect(unsupportedIn(letter, cv)).toEqual([]);
    expect(letter).not.toMatch(/—/);
  });

  it("adds greeting and sign-off once, even when the AI wrote its own", () => {
    const body =
      "Dear hiring manager,\n\nI build payment APIs in PHP.\n\nKind regards,\nSam Tester";
    const letter = wrapLetter(body, cv, job);
    expect(letter.match(/Dear/g)).toHaveLength(1);
    expect(letter.match(/Kind regards/g)).toHaveLength(1);
  });

  it("flags a body with a technology or number the CV lacks", () => {
    expect(letterProblems("I run Kubernetes clusters for 40 teams.", cv).length).toBeGreaterThan(0);
    expect(letterProblems("I built payment APIs in PHP and Symfony.", cv)).toEqual([]);
  });
});
