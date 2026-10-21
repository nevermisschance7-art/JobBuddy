import { describe, expect, it } from "vitest";
import { freshness, locationLabel, postedLabel, salaryLabel, scoreBand } from "./job-display";

const now = new Date("2026-10-21T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

describe("freshness", () => {
  it.each([
    [2, "new"],
    [30, "recent"],
    [24 * 5, "relevant"],
    [24 * 20, "older"],
  ] as const)("%s hours ago is %s", (hours, label) => {
    expect(freshness(ago(hours), now)).toBe(label);
  });

  it("never invents a date", () => {
    expect(freshness(null, now)).toBe("unknown");
    expect(postedLabel(null, now)).toBe("Date unknown");
  });

  it("labels the posting day", () => {
    expect(postedLabel(ago(3), now)).toBe("Posted today");
    expect(postedLabel(ago(26), now)).toBe("Posted yesterday");
    expect(postedLabel(ago(24 * 6), now)).toBe("Posted 6 days ago");
  });
});

describe("locationLabel", () => {
  it("names countries", () => {
    expect(
      locationLabel({ countries: ["DE", "GB"], remote_regions: [], remote_type: "hybrid" }),
    ).toBe("Germany, United Kingdom");
  });

  it("describes remote regions", () => {
    expect(
      locationLabel({ countries: [], remote_regions: ["EUROPE"], remote_type: "remote" }),
    ).toBe("Remote, Europe");
    expect(locationLabel({ countries: [], remote_regions: [], remote_type: "remote" })).toBe(
      "Remote, limits not stated",
    );
  });
});

describe("salaryLabel", () => {
  it("shows only stated salaries", () => {
    expect(salaryLabel(null, null, null)).toBeNull();
    expect(salaryLabel(70000, 85000, "EUR")).toBe("€70K to €85K");
    expect(salaryLabel(60000, null, "GBP")).toBe("£60K");
  });
});

describe("scoreBand", () => {
  it("bands scores", () => {
    expect([90, 75, 60, 40].map(scoreBand)).toEqual(["great", "good", "fair", "low"]);
  });
});
