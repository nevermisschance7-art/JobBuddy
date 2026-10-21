import { resumeSchema } from "@jobbuddy/shared";
import { describe, expect, it } from "vitest";
import { cvTextToResume } from "./to-resume";

const CV = `Sam Tester
sam.tester@example.com | +44 7700 900123
linkedin.com/in/sam-tester github.com/samtester

Experience
Backend Engineer, Acme Ltd, 2021 - present

Skills
Python, TypeScript, PostgreSQL
Docker | AWS
`;

describe("cvTextToResume", () => {
  const resume = cvTextToResume(CV);

  it("reads contact details", () => {
    expect(resume.basics.name).toBe("Sam Tester");
    expect(resume.basics.email).toBe("sam.tester@example.com");
    expect(resume.basics.phone).toBe("+44 7700 900123");
  });

  it("reads profile links", () => {
    expect(resume.basics.profiles.map((p) => p.url)).toEqual([
      "https://linkedin.com/in/sam-tester",
      "https://github.com/samtester",
    ]);
  });

  it("reads skills under the Skills heading only", () => {
    expect(resume.skills[0]?.keywords).toEqual([
      "Python",
      "TypeScript",
      "PostgreSQL",
      "Docker",
      "AWS",
    ]);
  });

  it("produces a valid JSON Resume", () => {
    expect(resumeSchema.safeParse(resume).success).toBe(true);
  });

  it("never invents work history", () => {
    expect(resume.work).toEqual([]);
  });
});
