import { describe, expect, it, vi } from "vitest";
import {
  answerQuestions,
  fixedKeyFor,
  questionSimilarity,
  REUSE_THRESHOLD,
  splitQuestions,
  wordLimitIn,
  type DraftDeps,
} from "./answers";

const deps = (over: Partial<DraftDeps> = {}): DraftDeps => ({
  fixedAnswers: { needs_sponsorship: "No", salary_expectation: "70,000 GBP" },
  memory: [],
  company: "Acme",
  draft: vi.fn(async ({ question }) => ({ text: `Draft for: ${question}` })),
  ...over,
});

describe("fixedKeyFor", () => {
  it.each([
    ["Will you now or in the future require visa sponsorship?", "needs_sponsorship"],
    ["Are you legally authorised to work in the UK?", "right_to_work"],
    ["What are your salary expectations?", "salary_expectation"],
    ["What is your notice period?", "notice_period"],
    ["Are you willing to relocate to Berlin?", "willing_to_relocate"],
    ["Where are you currently based?", "location"],
    ["Gender", "demographics"],
    ["Do you identify as having a disability?", "demographics"],
    ["LinkedIn profile", "linkedin_url"],
  ])("%s -> %s", (q, key) => expect(fixedKeyFor(q)).toBe(key));

  it("leaves ordinary questions to drafting", () => {
    expect(fixedKeyFor("Why do you want to work at Acme?")).toBeNull();
    expect(fixedKeyFor("Tell us about a project you are proud of")).toBeNull();
  });
});

describe("answerQuestions", () => {
  it("never sends sensitive questions or fixed answers to the AI", async () => {
    const d = deps();
    const out = await answerQuestions(
      [
        { text: "Do you need sponsorship?" },
        { text: "Salary expectations?" },
        { text: "Notice period?" },
      ],
      d,
    );
    expect(d.draft).not.toHaveBeenCalled();
    expect(out.map((a) => a.kind)).toEqual(["fixed", "fixed", "missing_fixed"]);
    expect(out[0]!.answer).toBe("No");
    expect(out[2]!.answer).toBe("");
  });

  it("drafted prompts never include fixed answers", async () => {
    const d = deps();
    await answerQuestions([{ text: "Why this role?" }], d);
    const input = JSON.stringify(vi.mocked(d.draft).mock.calls[0]![0]);
    expect(input).not.toContain("70,000");
  });

  it("reuses a past answer at or above the threshold, drafts below it", async () => {
    const d = deps({
      memory: [
        {
          question: "Why do you want to work at Beta?",
          answer: "I like the product.",
          company: "Beta",
        },
      ],
    });
    const out = await answerQuestions(
      [{ text: "Why do you want to work at Acme?" }, { text: "Describe a hard bug you fixed" }],
      d,
    );
    expect(out[0]).toMatchObject({ kind: "reused", answer: "I like the product." });
    expect(out[1]!.kind).toBe("drafted");
    expect(d.draft).toHaveBeenCalledTimes(1);
  });

  it("scores clearly different questions below the threshold", () => {
    expect(
      questionSimilarity("Why do you want this job?", "What is your biggest weakness?"),
    ).toBeLessThan(REUSE_THRESHOLD);
    expect(questionSimilarity("Why Acme?", "Why Beta?", "Acme", "Beta")).toBe(1);
  });

  it("enforces word limits: passes the limit and flags longer answers", async () => {
    const long = Array.from({ length: 60 }, () => "word").join(" ");
    const d = deps({ draft: vi.fn(async () => ({ text: long })) });
    const out = await answerQuestions(
      [{ text: "Why us? (max 50 words)" }, { text: "Cover letter", coverLetter: true }],
      d,
    );
    expect(vi.mocked(d.draft).mock.calls[0]![0].maxWords).toBe(50);
    expect(vi.mocked(d.draft).mock.calls[1]![0].maxWords).toBe(180);
    expect(out[0]!.overLimit).toBe(true);
    expect(out[1]!.overLimit).toBe(false);
  });

  it("flags drafted claims the CV doesn't support", async () => {
    const d = deps({
      draft: vi.fn(async () => ({ text: "I set up CI/CD and Kafka" })),
      check: (t) => (t.includes("Kafka") ? ["ci/cd", "kafka"] : []),
    });
    const out = await answerQuestions([{ text: "Why us?" }], d);
    expect(out[0]!.unsupported).toEqual(["ci/cd", "kafka"]);
  });

  it("marks a failed draft instead of throwing", async () => {
    const d = deps({ draft: vi.fn(async () => Promise.reject(new Error("no keys"))) });
    const out = await answerQuestions([{ text: "Why us?" }], d);
    expect(out[0]!.kind).toBe("failed");
  });
});

describe("parsing", () => {
  it("reads limits from the question", () => {
    expect(wordLimitIn("Tell us about you (100 words max)")).toBe(100);
    expect(wordLimitIn("Up to 650 characters")).toBe(100);
    expect(wordLimitIn("Why us?")).toBeNull();
  });

  it("splits pasted questions", () => {
    expect(splitQuestions("1. Why us?\n\n- Notice period?\n  ok")).toEqual([
      "Why us?",
      "Notice period?",
    ]);
  });
});
