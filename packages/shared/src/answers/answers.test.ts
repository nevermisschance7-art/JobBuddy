import { describe, expect, it, vi } from "vitest";
import {
  adaptAnswer,
  aiMayChoose,
  validChoices,
  answerQuestions,
  fixedKeyFor,
  isNonAnswer,
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
    ["What is your location?", "location"],
    ["What location do you plan to work from?", "location"],
    [
      "Are you legally eligible to work in the country where you're planning to work from?",
      "right_to_work",
    ],
    ["¿Cuáles son tus pretensiones económicas?", "salary_expectation"],
    ["Gehaltsvorstellung", "salary_expectation"],
    ["Verfügbar ab", "notice_period"],
    ["Geschlecht", "demographics"],
    ["Wie bist du auf ARES gekommen?", "heard_about"],
    ["How Did You Hear About Us?", "heard_about"],
    ["Prétentions salariales", "salary_expectation"],
    ["Do you have one or more disabilities as described in the Equality Act 2010?", "demographics"],
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

  it("drafts at most maxDrafts answers with the AI; fixed answers don't count", async () => {
    const d = deps({ maxDrafts: 2 });
    const out = await answerQuestions(
      [
        { text: "Q one?" },
        { text: "Do you need sponsorship?" },
        { text: "Q two?" },
        { text: "Q three?" },
      ],
      d,
    );
    expect(d.draft).toHaveBeenCalledTimes(2);
    expect(out.map((a) => a.kind)).toEqual(["drafted", "fixed", "drafted", "failed"]);
  });

  it("drafts all answers in one AI call when draftMany is given; cover letter separately", async () => {
    const draftMany = vi.fn(async (inputs: { question: string }[]) =>
      inputs.map((i) => `A: ${i.question}`),
    );
    const d = deps({ draftMany });
    const out = await answerQuestions(
      [
        { text: "Why us?" },
        { text: "Salary?" },
        { text: "Best project?" },
        { text: "Cover letter", coverLetter: true },
      ],
      d,
    );
    expect(draftMany).toHaveBeenCalledTimes(1);
    expect(draftMany.mock.calls[0]![0].map((i) => i.question)).toEqual([
      "Why us?",
      "Best project?",
    ]);
    expect(d.draft).toHaveBeenCalledTimes(1);
    expect(out.map((a) => a.answer)).toEqual([
      "A: Why us?",
      "70,000 GBP",
      "A: Best project?",
      "Draft for: Cover letter",
    ]);
  });

  it("swaps the company name in a reused answer, without AI", () => {
    expect(adaptAnswer("I love Beta's product. Beta ships fast.", "Beta", "Acme")).toBe(
      "I love Acme's product. Acme ships fast.",
    );
    expect(adaptAnswer("Betamax rocks", "Beta", "Acme")).toBe("Betamax rocks");
  });

  it("marks a failed draft instead of throwing", async () => {
    const d = deps({ draft: vi.fn(async () => Promise.reject(new Error("no keys"))) });
    const out = await answerQuestions([{ text: "Why us?" }], d);
    expect(out[0]!.kind).toBe("failed");
  });

  it("leaves the field to the user when the AI only says it has no answer", async () => {
    for (const t of [
      "I do not have an example of this.",
      "I do not have an answer for this.",
      "I do not have details on a specific agent coding session beyond my experience with spec-driven development using AI coding agents.",
      "I don't have a specific example.",
      "N/A",
    ])
      expect(isNonAnswer(t), t).toBe(true);
    for (const t of [
      "I don't have a degree, but I have 7 years of PHP and Python work.",
      "I built queue-based services on AWS and cut processing time on large datasets.",
      "I do not have to think twice: your API is the reason.",
    ])
      expect(isNonAnswer(t), t).toBe(false);
    const d = deps({ draft: vi.fn(async () => ({ text: "I do not have an example of this." })) });
    const out = await answerQuestions([{ text: "A non-computer system you've hacked?" }], d);
    expect(out[0]).toMatchObject({ kind: "failed", answer: "" });
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

describe("choice questions", () => {
  it("lets the AI answer experience questions, never personal ones", () => {
    expect(aiMayChoose("Do you have experience in FinTech?")).toBe(true);
    expect(aiMayChoose("Do you have 4+ years of QA Engineering experience?")).toBe(true);
    expect(aiMayChoose("What is your English proficiency level?")).toBe(true);
    expect(aiMayChoose("Do you have any criminal convictions?")).toBe(false);
    expect(aiMayChoose("Have you ever interviewed at Anthropic before?")).toBe(false);
    expect(aiMayChoose("Are you open to working in-person in one of our offices?")).toBe(false);
    expect(aiMayChoose("I agree to the privacy policy")).toBe(false);
    expect(aiMayChoose("Do you require visa sponsorship?")).toBe(false);
  });

  it("keeps only picks that are one of the options", () => {
    const items = [
      { question: "FinTech?", options: ["Yes", "No"] },
      { question: "Years?", options: ["0-2", "3-5", "6+"] },
      { question: "Level?", options: ["B1", "B2", "C1"] },
    ];
    expect(
      validChoices(items, [
        { n: 1, answer: "yes" },
        { n: 2, answer: "7 years" },
        { n: 3, answer: "unsure" },
      ]),
    ).toEqual(["Yes", null, null]);
  });
});
