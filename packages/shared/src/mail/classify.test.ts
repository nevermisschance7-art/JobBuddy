import { describe, expect, it } from "vitest";
import { MAIL_RULES, classifyMail, isGoodNews } from "./classify";
import { baseDomain, employerDomains, isSharedJobHost, normalizeCompany } from "./companies";
import { MAIL_EXAMPLES } from "./examples.fixture";

describe("classifyMail", () => {
  for (const ex of MAIL_EXAMPLES) {
    it(`${ex.name} -> ${ex.want}`, () => {
      expect(classifyMail(ex)).toBe(ex.want);
    });
  }

  it("covers every kind of mail", () => {
    const kinds = new Set(MAIL_EXAMPLES.map((e) => e.want));
    for (const k of [
      "interview",
      "assessment",
      "offer",
      "next_step",
      "rejection",
      "received",
      "other",
    ])
      expect(kinds.has(k as never)).toBe(true);
    expect(MAIL_EXAMPLES.length).toBeGreaterThanOrEqual(25);
  });

  it("rejection wins over positive words", () => {
    expect(
      classifyMail({
        from: "jobs@acme.com",
        subject: "Your application",
        body: "Unfortunately we will not move forward to the interview stage. Please book a time if you want feedback.",
      }),
    ).toBe("rejection");
  });

  it("only good news counts as good news", () => {
    expect(["interview", "assessment", "offer", "next_step"].every(isGoodNews)).toBe(true);
    expect(["rejection", "received", "other"].some(isGoodNews)).toBe(false);
  });

  it("every rule is a valid regex without control characters", () => {
    for (const list of Object.values(MAIL_RULES)) {
      for (const src of list) {
        expect(() => new RegExp(src, "i")).not.toThrow();
        // eslint-disable-next-line no-control-regex
        expect(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(src)).toBe(false);
      }
    }
  });
});

describe("employer domains", () => {
  it("normalizes company names", () => {
    expect(normalizeCompany("Acme Labs, Inc.")).toBe("acme labs");
    expect(normalizeCompany("Zürich Tech GmbH")).toBe("zurich tech");
  });

  it("keeps the employer's own site and drops shared job hosts", () => {
    expect(baseDomain("careers.acme.com")).toBe("acme.com");
    expect(baseDomain("jobs.acme.co.uk")).toBe("acme.co.uk");
    expect(isSharedJobHost("boards.greenhouse.io")).toBe(true);
    expect(isSharedJobHost("www.adzuna.de")).toBe(true);
    expect(isSharedJobHost("acme.com")).toBe(false);
    expect(
      employerDomains("Acme Labs Inc", [
        "https://careers.acmelabs.io/jobs/1",
        "https://boards.greenhouse.io/acme/jobs/1",
        "https://www.linkedin.com/jobs/view/1",
        "not a url",
        null,
      ]),
    ).toEqual(["acmelabs.io", "acmelabs"]);
    expect(employerDomains("X", ["https://jobs.lever.co/x/1"])).toEqual([]);
  });
});

describe("seen in a real inbox", () => {
  it("an advert from LinkedIn is never good news", () => {
    expect(
      classifyMail({
        from: "LinkedIn Premium <premium@em.linkedin.com>",
        subject: "Iuri, reactivate your Premium trial for your job search",
        body: "Get noticed by recruiters and land interviews faster. Start your free trial.",
      }),
    ).toBe("other");
  });
  it("a receipt that mentions a later assessment stays a receipt", () => {
    expect(
      classifyMail({
        from: "Praxent <no-reply@us.greenhouse-mail.io>",
        subject: "Thank you for applying to Praxent",
        body: "We received your application. If selected, you will be asked to complete a short assessment.",
      }),
    ).toBe("received");
  });
  it("an interview confirmation is still good news", () => {
    expect(
      classifyMail({
        from: "WhiteTech <no-reply@eu.greenhouse-mail.io>",
        subject: "WhiteTech | Interview Confirmation",
        body: "Thank you for applying. Your interview is confirmed for Monday at 10:00.",
      }),
    ).toBe("interview");
  });
});
