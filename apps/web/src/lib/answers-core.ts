import {
  answerQuestions,
  type DraftedAnswer,
  type DraftInput,
  type PastAnswer,
  type Resume,
  unsupportedIn,
} from "@jobbuddy/shared";
import { applyStyle, type LlmRouter, type PersonalInfo } from "@jobbuddy/shared/llm";
import { z } from "zod";

// Pure (no server-only imports) so the AI check workflow can run it against real models.

export type AnswerJob = { title: string; company_name: string; description_text: string };

/** What the board stores in applications.answers: the draft plus the user's final text. */
export type StoredAnswer = DraftedAnswer & { final?: string };

const SYSTEM = `You write a job application answer for the candidate, as the candidate ("I").
Rules:
- Only use facts from the candidate's CV below. Never invent experience, numbers, employers, skills or technologies.
- Never describe steps, methods, causes or results the CV doesn't state. If the CV gives little detail, stay short and general rather than filling gaps.
- Plain, short, human and specific. No buzzwords, no clichés, no em dashes.
- Match the style of the candidate's past answers when given.
- Answer in the language the question is written in.
- Never mention salary, visa, sponsorship, notice period, location or personal details.
- Return only the answer text.
Placeholders like {{NAME}} stand for real values: keep them as they are.`;

function cvFacts(r: Resume): string {
  const work = r.work
    .slice(0, 4)
    .map((w) => `- ${w.position} at ${w.name}: ${w.highlights.slice(0, 4).join("; ")}`)
    .join("\n");
  const skills = r.skills
    .flatMap((s) => s.keywords)
    .slice(0, 30)
    .join(", ");
  const projects = r.projects
    .slice(0, 3)
    .map((p) => `- ${p.name}: ${p.description ?? ""}`)
    .join("\n");
  return [
    r.basics.summary ? `Summary: ${r.basics.summary}` : "",
    `Experience:\n${work}`,
    `Skills: ${skills}`,
    projects ? `Projects:\n${projects}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function draftPrompt(input: DraftInput, job: AnswerJob, cv: Resume): string {
  const examples = input.examples.map((e) => `Q: ${e.question}\nA: ${e.answer}`).join("\n\n");
  return `Job: ${job.title} at ${job.company_name}
Job description (shortened):
"""
${job.description_text.slice(0, 2500)}
"""

The candidate's CV:
${cvFacts(cv)}
${examples ? `\nThe candidate's past answers (copy their style, not their content):\n${examples}\n` : ""}
${input.isCoverLetter ? `Write a short cover letter for this job, at most ${input.maxWords} words. No address block, no date. Start with "Hi" or "Dear Hiring Team".` : `Question: ${input.question}\nAnswer in at most ${input.maxWords} words.`}`;
}

const SYSTEM_MANY = SYSTEM.replace(
  "- Return only the answer text.",
  '- Return JSON: {"answers": [{"n": 1, "answer": "..."}, ...]}, one answer per numbered question, each within its word limit.',
);

const manySchema = z.object({
  answers: z.array(z.object({ n: z.number().int(), answer: z.string() })),
});

function manyPrompt(
  inputs: DraftInput[],
  examples: PastAnswer[],
  job: AnswerJob,
  cv: Resume,
): string {
  const past = examples.map((e) => `Q: ${e.question}\nA: ${e.answer}`).join("\n\n");
  const questions = inputs
    .map((x, i) => `${i + 1}. ${x.question} (at most ${x.maxWords} words)`)
    .join("\n");
  const pastBlock = past
    ? `\nThe candidate's past answers (copy their style, not their content):\n${past}\n`
    : "";
  return `Job: ${job.title} at ${job.company_name}
Job description (shortened):
"""
${job.description_text.slice(0, 2500)}
"""

The candidate's CV:
${cvFacts(cv)}
${pastBlock}
Answer each question as the candidate:
${questions}`;
}

/** Fixed answers first, then reuse, then the AI. Fixed answers never reach the AI. */
export async function draftWithRouter(
  router: LlmRouter,
  userId: string,
  job: AnswerJob,
  cv: Resume,
  questions: { text: string; coverLetter?: boolean }[],
  fixedAnswers: Record<string, string>,
  memory: PastAnswer[],
  personal: PersonalInfo,
): Promise<StoredAnswer[]> {
  return answerQuestions(questions, {
    fixedAnswers,
    memory,
    check: (text) => unsupportedIn(text, cv),
    company: job.company_name,
    draft: (input) =>
      router.generateText(
        input.isCoverLetter ? "cover_letter" : "draft_answer",
        draftPrompt(input, job, cv),
        input.maxWords,
        userId,
        {
          system: SYSTEM,
          personal,
        },
      ),
    // One request for every answer on the form (free tiers allow ~1,000 requests a day).
    draftMany: async (inputs) => {
      const examples = [
        ...new Map(inputs.flatMap((x) => x.examples).map((e) => [e.question, e])).values(),
      ].slice(0, 5);
      const result = await router.generateJson(
        "draft_answer",
        manySchema,
        manyPrompt(inputs, examples, job, cv),
        userId,
        { system: SYSTEM_MANY, personal },
      );
      return inputs.map((input, i) => {
        const raw = result.answers.find((a) => a.n === i + 1)?.answer ?? "";
        return raw ? applyStyle(raw, input.maxWords).text : "";
      });
    },
  });
}
