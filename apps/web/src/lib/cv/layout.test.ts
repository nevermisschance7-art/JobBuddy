import { resumeSchema } from "@jobbuddy/shared";
import { describe, expect, it } from "vitest";
import { cvBlocks, cvFileName, formatDate } from "./layout";

const resume = resumeSchema.parse({
  basics: { name: "Łukasz Nowak", email: "l@example.com", summary: "Backend developer." },
  work: [{ name: "Acme", position: "Engineer", startDate: "2021-03", highlights: ["Built APIs"] }],
  skills: [{ name: "Backend", keywords: ["Python", "Go"] }],
});

describe("cv layout", () => {
  it("formats dates", () => {
    expect(formatDate("2021-03")).toBe("Mar 2021");
    expect(formatDate("2021")).toBe("2021");
    expect(formatDate(undefined)).toBe("");
  });

  it("uses standard section names in a single column", () => {
    const blocks = cvBlocks(resume);
    expect(
      blocks.filter((b) => b.kind === "section").map((b) => b.kind === "section" && b.text),
    ).toEqual(["Summary", "Experience", "Skills"]);
    expect(blocks).toContainEqual({
      kind: "entry",
      title: "Engineer, Acme",
      right: "Mar 2021 - Present",
      sub: undefined,
    });
    expect(blocks).toContainEqual({ kind: "paragraph", text: "Python, Go" });
  });

  it("makes a safe file name", () => {
    expect(cvFileName(resume, "Acme & Co.")).toBe("Lukasz-Nowak-CV-Acme-Co");
  });
});
