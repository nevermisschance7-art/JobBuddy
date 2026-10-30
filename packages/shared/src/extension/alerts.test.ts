import { describe, expect, it } from "vitest";
import { alertMessage, alertsToShow, inQuietHours } from "./alerts";

const quiet = { quiet_hours: { start: "22:00", end: "08:00" } };

describe("quiet hours", () => {
  it("handles ranges over midnight in the user's time zone", () => {
    // 23:30 in Warsaw (UTC+1 in winter)
    expect(inQuietHours(new Date("2026-11-10T22:30:00Z"), "Europe/Warsaw", quiet)).toBe(true);
    // 07:30 Warsaw
    expect(inQuietHours(new Date("2026-11-10T06:30:00Z"), "Europe/Warsaw", quiet)).toBe(true);
    // 12:00 Warsaw
    expect(inQuietHours(new Date("2026-11-10T11:00:00Z"), "Europe/Warsaw", quiet)).toBe(false);
  });

  it("falls back to UTC for a bad time zone", () => {
    expect(inQuietHours(new Date("2026-11-10T12:00:00Z"), "Not/AZone", quiet)).toBe(false);
  });
});

describe("alertsToShow", () => {
  const events = [
    { id: "2", type: "hot_match", payload: {}, created_at: "2026-11-10T10:05:00Z" },
    { id: "1", type: "daily_summary", payload: {}, created_at: "2026-11-10T10:00:00Z" },
    { id: "3", type: "something_else", payload: {}, created_at: "2026-11-10T10:06:00Z" },
  ];
  const noon = new Date("2026-11-10T11:00:00Z");

  it("keeps enabled known types, oldest first", () => {
    expect(
      alertsToShow(
        events,
        { ...quiet, enabled_types: ["hot_match", "daily_summary"] },
        "UTC",
        noon,
      ).map((e) => e.id),
    ).toEqual(["1", "2"]);
    expect(
      alertsToShow(events, { ...quiet, enabled_types: ["hot_match"] }, "UTC", noon).map(
        (e) => e.id,
      ),
    ).toEqual(["2"]);
  });

  it("shows nothing during quiet hours", () => {
    expect(alertsToShow(events, quiet, "UTC", new Date("2026-11-10T23:00:00Z"))).toEqual([]);
  });
});

describe("alertMessage", () => {
  it("uses the tone and never an em dash", () => {
    const e = {
      id: "1",
      type: "hot_match",
      payload: { title: "Backend Engineer", company: "Acme", score: 88 },
      created_at: "",
    };
    for (const tone of ["kind", "funny", "plain"] as const) {
      const m = alertMessage(e, tone);
      expect(m.title).toBe("Strong match: 88/100");
      expect(m.message).toContain("Backend Engineer at Acme");
      expect(m.message).not.toContain("\u2014");
    }
  });

  it("says what the good news is", () => {
    const e = (classification: string) => ({
      id: "1",
      type: "good_news",
      payload: { company: "Acme", subject: "Next steps", classification },
      created_at: "",
    });
    expect(alertMessage(e("interview"), "plain")).toEqual({
      title: "Good news",
      message: "Acme wants to talk with you: Next steps",
    });
    expect(alertMessage(e("offer"), "kind").title).toBe("You got an offer");
    for (const tone of ["kind", "funny", "plain"] as const) {
      expect(alertMessage(e("assessment"), tone).message).toContain("Acme sent you a test");
      expect(alertMessage(e("assessment"), tone).message).not.toContain(String.fromCharCode(8212));
    }
  });

  it("pluralises the daily summary", () => {
    const e = (n: number) => ({
      id: "1",
      type: "daily_summary",
      payload: { new_matches: n },
      created_at: "",
    });
    expect(alertMessage(e(1), "plain").message).toBe("1 new job matches your filters.");
    expect(alertMessage(e(3), "plain").message).toBe("3 new jobs match your filters.");
  });
});
