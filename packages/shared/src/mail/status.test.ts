import { describe, expect, it } from "vitest";
import { statusAfterMail } from "./status";

describe("statusAfterMail", () => {
  it("moves forward only", () => {
    expect(statusAfterMail("applied", "interview")).toBe("interview");
    expect(statusAfterMail("applied", "next_step")).toBe("interview");
    expect(statusAfterMail("prepared", "assessment")).toBe("assessment");
    expect(statusAfterMail("ghosted", "assessment")).toBe("assessment");
    expect(statusAfterMail("assessment", "interview")).toBe("interview");
    expect(statusAfterMail("interview", "offer")).toBe("offer");
    expect(statusAfterMail("interview", "assessment")).toBeNull();
    expect(statusAfterMail("offer", "interview")).toBeNull();
  });

  it("marks receipts applied only when still prepared", () => {
    expect(statusAfterMail("prepared", "received")).toBe("applied");
    expect(statusAfterMail("interview", "received")).toBeNull();
  });

  it("closes on rejection, but never an offer or a closed application", () => {
    expect(statusAfterMail("interview", "rejection")).toBe("rejected");
    expect(statusAfterMail("offer", "rejection")).toBeNull();
    expect(statusAfterMail("withdrawn", "interview")).toBeNull();
    expect(statusAfterMail("rejected", "interview")).toBeNull();
    expect(statusAfterMail("applied", "other")).toBeNull();
  });
});
