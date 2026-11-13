import { describe, expect, it } from "vitest";
import { dayStart, nextDay, reportCsv, reportRange } from "./report";

describe("applied report", () => {
  it("starts a day at local midnight", () => {
    expect(dayStart("2026-07-01", "Europe/London")).toBe("2026-06-30T23:00:00.000Z");
    expect(dayStart("2026-11-13", "Europe/London")).toBe("2026-11-13T00:00:00.000Z");
    expect(dayStart("2026-11-13", null)).toBe("2026-11-13T00:00:00.000Z");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("defaults to the last 7 days and keeps the range sane", () => {
    const { from, to } = reportRange(undefined, "2026-11-13", "UTC");
    expect([from, to]).toEqual(["2026-11-07", "2026-11-13"]);
    expect(reportRange("2026-11-20", "2026-11-10", "UTC").from).toBe("2026-11-10");
  });

  it("writes a CSV a spreadsheet opens safely", () => {
    const csv = reportCsv(
      [
        {
          applied_at: "2026-11-12T15:30:00Z",
          status: "applied",
          jobs: {
            title: "Senior Engineer, Platform",
            company_name: "=Acme",
            apply_url: "https://x.test/1",
            source: "greenhouse",
          },
        },
      ],
      "Europe/London",
    );
    const [head, row] = csv.trim().split("\r\n");
    expect(head).toBe("Applied,Company,Job title,Status,Source,Link");
    expect(row).toBe(
      `"12/11/2026, 15:30",'=Acme,"Senior Engineer, Platform",applied,greenhouse,https://x.test/1`,
    );
  });
});
