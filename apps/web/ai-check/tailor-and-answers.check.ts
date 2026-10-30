import { mkdirSync, writeFileSync } from "node:fs";
import { isNonAnswer, resumeSchema } from "@jobbuddy/shared";
import { LlmRouter, type LlmCallLog, type ProviderKey } from "@jobbuddy/shared/llm";
import { describe, expect, it } from "vitest";
import { draftWithRouter, pickChoicesWithRouter } from "@/lib/answers-core";
import { coverLetterWithRouter, tailorWithRouter } from "@/lib/cv/tailor-core";
import { renderDocx, renderPdf } from "@/lib/cv/render";

// Manual check against REAL models (the "AI check" workflow), never part of `pnpm test`.
// Runs the same tailoring and answer code as the web app on a made-up CV and job, and
// reports timings and output. Files land in ai-check-output/ (uploaded as an artifact).

const OUT = "ai-check-output";
mkdirSync(OUT, { recursive: true });

// Each env value may list several keys, comma-separated (as on the server).
const keys: ProviderKey[] = (
  ["gemini", "groq", "cerebras", "mistral", "openrouter"] as const
).flatMap((provider) =>
  (process.env[`${provider.toUpperCase()}_API_KEY`] ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((apiKey) => ({ provider, apiKey, coolingUntil: null }) as ProviderKey),
);

const calls: LlmCallLog[] = [];
const router = new LlmRouter({
  keys: {
    getKeys: async () => keys,
    markCoolingDown: async (_u, p, until) =>
      console.log(`${p} cooling down until ${until.toISOString()}`),
    markBroken: async (_u, p, e) => console.log(`${p} key broken: ${e}`),
  },
  sinks: {
    logCall: async (e) => {
      calls.push(e);
    },
    needsFixing: async (_u, m) => console.log(`needs fixing: ${m}`),
  },
});

const cv = resumeSchema.parse({
  basics: {
    name: "Sam Tester",
    label: "Backend Engineer",
    email: "sam.tester@example.com",
    phone: "+44 7700 900123",
    summary: "Backend engineer with 6 years of Python and cloud work.",
    location: { city: "Manchester", countryCode: "GB" },
  },
  work: [
    {
      name: "Brightbank",
      position: "Senior Backend Engineer",
      startDate: "2022-02",
      highlights: [
        "Led the move of the payments API from a monolith to 6 Python services on AWS",
        "Cut p95 latency of the card authorisation endpoint from 900 ms to 250 ms",
        "Set up GitHub Actions pipelines with Docker builds for 14 services",
        "Mentored 3 junior engineers through code review and pairing",
        "Wrote the on-call runbook used by the team",
      ],
    },
    {
      name: "Shopline",
      position: "Backend Developer",
      startDate: "2019-06",
      endDate: "2022-01",
      highlights: [
        "Built the order service in Django and PostgreSQL handling 40,000 orders a day",
        "Added Redis caching to product search, cutting database load by 35%",
        "Maintained the internal admin tool in React",
      ],
    },
    {
      name: "Northgate Council",
      position: "Junior Developer",
      startDate: "2018-01",
      endDate: "2019-05",
      highlights: ["Built small PHP tools for the housing team", "Moved reports from Excel to SQL"],
    },
  ],
  education: [
    {
      institution: "University of Leeds",
      studyType: "BSc",
      area: "Computer Science",
      endDate: "2017",
    },
  ],
  skills: [
    { name: "Languages", keywords: ["Python", "SQL", "JavaScript", "PHP"] },
    { name: "Backend", keywords: ["Django", "FastAPI", "PostgreSQL", "Redis"] },
    { name: "Cloud", keywords: ["AWS", "Docker", "GitHub Actions", "Terraform"] },
  ],
  projects: [
    {
      name: "queue-watch",
      description: "Open source tool that alerts on stuck SQS queues",
      keywords: ["Python", "AWS"],
    },
  ],
  languages: [{ language: "English", fluency: "Native" }],
});

const job = {
  title: "Senior Python Engineer (Remote, Europe)",
  company_name: "Fluxpay",
  description_text: `Fluxpay builds payment infrastructure for online shops across Europe.
You will join the Core Payments team and own services that move money reliably.
What you'll do: design and run Python services (FastAPI) on AWS; improve latency and reliability
of our payment APIs; work with Kafka for event streaming; help us run Kubernetes in production;
review code and support other engineers.
What we look for: 5+ years building backend systems in Python; PostgreSQL; AWS; experience with
payments or fintech; Kafka or another event system; Kubernetes is a plus; Terraform is a plus.
Fully remote within Europe. We cannot offer visa sponsorship.`,
};

const personal = { name: cv.basics.name, email: cv.basics.email, phone: cv.basics.phone };

function report(label: string, started: number) {
  const secs = (Date.now() - started) / 1000;
  const mine = calls.splice(0);
  console.log(`\n=== ${label}: ${secs.toFixed(1)} s`);
  for (const c of mine) {
    console.log(
      `  ${c.task} ${c.provider}/${c.model} ok=${c.ok} ${c.latencyMs} ms ${c.errorKind ?? ""} ${c.errorMessage ?? ""}`,
    );
  }
  return secs;
}

describe.skipIf(keys.length === 0)("AI check: tailoring and answers", () => {
  it("tailors the CV and renders files", async () => {
    const started = Date.now();
    const result = await tailorWithRouter(router, "ai-check", cv, job, personal);
    const secs = report("tailor_cv", started);
    if (!result.ok) throw new Error(result.error);

    console.log("\nSummary:", result.resume.basics.summary);
    for (const w of result.resume.work) {
      console.log(`\n${w.position}, ${w.name}`);
      for (const h of w.highlights) console.log(`  - ${h}`);
    }
    console.log(
      "\nSkills:",
      result.resume.skills.map((s) => `${s.name}: ${s.keywords.join(", ")}`).join(" | "),
    );
    console.log("\nRemoved:", JSON.stringify(result.report.removed, null, 1));
    console.log("Corrected:", JSON.stringify(result.report.corrected, null, 1));
    console.log("Gaps:", result.report.gaps.join(", "));
    writeFileSync(`${OUT}/tailored.json`, JSON.stringify(result, null, 2));

    const t = Date.now();
    const [pdf, docx] = await Promise.all([renderPdf(result.resume), renderDocx(result.resume)]);
    console.log(
      `\nFiles: PDF ${pdf.length} bytes, Word ${docx.length} bytes, ${Date.now() - t} ms`,
    );
    writeFileSync(`${OUT}/tailored.pdf`, pdf);
    writeFileSync(`${OUT}/tailored.docx`, docx);

    expect(result.resume.work.map((w) => w.name)).toEqual(
      expect.arrayContaining(["Brightbank", "Shopline"]),
    );
    expect(result.resume.basics.email).toBe(cv.basics.email);
    console.log(`\nTailoring took ${secs.toFixed(1)} s in total.`);
  }, 180_000);

  it("writes a cover letter for the job from the CV only", async () => {
    const started = Date.now();
    const letter = await coverLetterWithRouter(router, "ai-check", cv, job, personal);
    report(`cover letter (${letter.byAi ? "AI" : "from CV facts"})`, started);
    console.log(`
${letter.text}
`);
    expect(letter.text.startsWith("Dear")).toBe(true);
    expect(letter.text).toContain(cv.basics.name);
  }, 180_000);

  it("drafts answers; sensitive ones come from fixed answers", async () => {
    const started = Date.now();
    const answers = await draftWithRouter(
      router,
      "ai-check",
      job,
      cv,
      [
        { text: "Why do you want to work at Fluxpay?" },
        { text: "Tell us about a time you improved the performance of a system (max 120 words)" },
        { text: "Do you require visa sponsorship?" },
        { text: "What are your salary expectations?" },
        { text: "What is your notice period?" },
        { text: "Cover letter", coverLetter: true },
      ],
      { needs_sponsorship: "No", salary_expectation: "85,000 EUR" },
      [
        {
          question: "Why do you want to work at Shopflow?",
          answer:
            "I like working on systems that shops depend on every day, and your team seems to care about doing it well.",
          company: "Shopflow",
        },
      ],
      personal,
    );
    report("answers", started);
    for (const a of answers) {
      if (a.unsupported?.length) console.log(`\n(flagged, not in CV: ${a.unsupported.join(", ")})`);
      console.log(
        `\n[${a.kind}] ${a.question} (${a.answer.split(/\s+/).filter(Boolean).length}/${a.maxWords} words)\n${a.answer}`,
      );
    }
    writeFileSync(`${OUT}/answers.json`, JSON.stringify(answers, null, 2));

    expect(answers[0]!.kind).toBe("reused");
    expect(answers[2]).toMatchObject({ kind: "fixed", answer: "No" });
    expect(answers[3]).toMatchObject({ kind: "fixed", answer: "85,000 EUR" });
    expect(answers[4]!.kind).toBe("missing_fixed");
    expect(answers[1]!.kind).toBe("drafted");
  }, 180_000);

  it("answers opinion questions and never writes 'I have no example'", async () => {
    const started = Date.now();
    const questions = [
      "What is an example of a non-computer system you've hacked to your advantage?",
      "What task or activity do you think AI will make much easier or better for you by next year? Why can't it do that well today?",
      "Tell us about an agent coding session you are particularly proud of. Explain how you helped the LLM build initial context, how you decided on the implementation plan, and how you validated what was generated/changed.",
      "What is the most challenging scalability problem you have tackled?",
      "Tell us about a project where you had to make trade-offs between shipping speed and shipping the perfect solution.",
    ];
    const answers = await draftWithRouter(
      router,
      "ai-check",
      job,
      cv,
      questions.map((text) => ({ text })),
      {},
      [],
      personal,
    );
    report("opinion and story answers", started);
    for (const a of answers)
      console.log(`
[${a.kind}] ${a.question}
${a.answer}`);
    // The opinion question always gets an answer; story questions get one or are left empty.
    expect(answers[1]).toMatchObject({ kind: "drafted" });
    for (const a of answers) expect(isNonAnswer(a.answer), a.answer).toBe(false);
  }, 180_000);

  it("picks choice answers only where the CV supports them", async () => {
    const started = Date.now();
    const items = [
      { question: "Do you have experience with Python?", options: ["Yes", "No"] },
      {
        question: "How many years of backend experience do you have?",
        options: ["0-2", "3-5", "6+"],
      },
      { question: "Do you have experience in payments or fintech?", options: ["Yes", "No"] },
      { question: "Do you have production experience with Kubernetes?", options: ["Yes", "No"] },
      { question: "What is your English level?", options: ["B1", "B2", "C1", "Native"] },
      {
        question: "Are you open to working from our office 3 days a week?",
        options: ["Yes", "No"],
      },
    ];
    const picks = await pickChoicesWithRouter(router, "ai-check", job, cv, items, personal);
    report("choices", started);
    items.forEach((it, i) =>
      console.log(`  ${it.question} -> ${picks[i] ?? "(left for the user)"}`),
    );
    expect(picks[0]).toBe("Yes");
    expect(picks[2]).toBe("Yes");
    // Not in the CV: never claimed.
    expect(picks[3]).not.toBe("Yes");
    expect(picks[4]).toBe("Native");
    // Personal: filtered out before the AI.
    expect(picks[5]).toBeNull();
  }, 180_000);
});
