import { describe, expect, it } from "vitest";
import { cleanResume } from "./resume-clean";

describe("cleanResume", () => {
  it("drops empty strings and empty list items", () => {
    expect(
      cleanResume({
        basics: { name: "Sam", email: "  ", profiles: [] },
        work: [
          { name: "", position: "" },
          { name: "Acme", position: "Dev", highlights: ["x", ""] },
        ],
      }),
    ).toEqual({
      basics: { name: "Sam", profiles: [] },
      work: [{ name: "Acme", position: "Dev", highlights: ["x"] }],
    });
  });

  it("adds https:// to bare URLs", () => {
    expect(cleanResume({ url: "github.com/sam" })).toEqual({ url: "https://github.com/sam" });
    expect(cleanResume({ url: "http://x.dev" })).toEqual({ url: "http://x.dev" });
  });
});
