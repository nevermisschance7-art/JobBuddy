import { describe, expect, it } from "vitest";
import { isConsentBox, standardAnswer } from "./standard";

describe("standing answers", () => {
  it("answers personal questions the owner's way", () => {
    for (const q of [
      "Have you previously applied to Acme?",
      "Have you ever interviewed with us before?",
      "Are you open to travel up to 20% of the time?",
      "Are you willing to work weekends or night shifts?",
      "This role requires 3 days a week in the office. Are you comfortable with that?",
      "Are you able to work on-site in Austin?",
      "Do you hold an active security clearance?",
      "Have you ever been convicted of a criminal offence?",
      "Do you have any relatives currently working at Acme?",
      "Do you require any reasonable adjustments or accommodations?",
      "Are you bound by a non-compete agreement?",
    ]) {
      expect(standardAnswer(q)?.choice, q).toBe("No");
    }
    expect(standardAnswer("Are you open to working in the office?")?.text).toMatch(/fully remote/);
  });

  it("leaves other questions alone", () => {
    for (const q of [
      "Why do you want to work at Acme?",
      "How many years of PHP experience do you have?",
      "Do you have experience with Kubernetes?",
      "What is your notice period?",
      "Describe a time you improved performance.",
    ]) {
      expect(standardAnswer(q), q).toBeNull();
    }
  });

  it("ticks consent boxes, never marketing opt-ins", () => {
    expect(isConsentBox("I have read and agree to the Privacy Policy")).toBe(true);
    expect(isConsentBox("I certify that the information above is true")).toBe(true);
    expect(isConsentBox("Yes, I agree to receive job alerts and marketing emails")).toBe(false);
    expect(isConsentBox("Keep me informed about future opportunities")).toBe(false);
  });
});
