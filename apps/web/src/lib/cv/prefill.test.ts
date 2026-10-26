import { resumeSchema } from "@jobbuddy/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { levelsFromTitle, linksFromResume } = await import("./prefill");

describe("levelsFromTitle", () => {
  it.each([
    ["Senior Backend Engineer", ["senior", "lead"]],
    ["Staff Engineer", ["senior", "lead", "principal"]],
    ["Engineering Manager", ["senior", "lead"]],
    ["Junior Developer", ["junior", "mid"]],
    ["Software Engineer", ["mid", "senior"]],
    ["", []],
  ])("%s", (title, levels) => {
    expect(levelsFromTitle(title)).toEqual(levels);
  });
});

describe("linksFromResume", () => {
  it("sorts profile links into fixed answers", () => {
    const resume = resumeSchema.parse({
      basics: {
        name: "Sam",
        url: "https://sam.dev",
        profiles: [
          { network: "LinkedIn", url: "https://linkedin.com/in/sam" },
          { network: "GitHub", url: "https://github.com/sam" },
        ],
      },
    });
    expect(linksFromResume(resume)).toEqual({
      linkedin_url: "https://linkedin.com/in/sam",
      github_url: "https://github.com/sam",
      portfolio_url: "https://sam.dev",
    });
  });
});
