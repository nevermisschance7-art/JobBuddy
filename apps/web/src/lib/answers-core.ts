import {
  answerQuestions,
  type DraftedAnswer,
  type DraftInput,
  type PastAnswer,
  type Resume,
  aiMayChoose,
  type ChoiceQuestion,
  unsupportedIn,
  validChoices,
} from "@jobbuddy/shared";
import { applyStyle, type LlmRouter, type PersonalInfo } from "@jobbuddy/shared/llm";
import { z } from "zod";

// Pure (no server-only imports) so the AI check workflow can run it against real models.

export type AnswerJob = { title: string; company_name: string; description_text: string };

/** What the board stores in applications.answers: the draft plus the user's final text. */
export type StoredAnswer = DraftedAnswer & {
  final?: string;
  /** A choice question (Yes/No, dropdown) whose option the AI picked from the CV. */
  choice?: boolean;
};

const SYSTEM = `You write a job application answer for the candidate, as the candidate ("I").
Rules:
- Facts about the candidate (experience, employers, projects, numbers, skills, technologies, results) come only from the CV below. Never invent them.
- Never describe steps, methods, causes or results the CV doesn't state. If the CV gives little detail, stay short and general rather than filling gaps.
- Opinion and motivation questions (why this company, what you think about something, how AI or a tool will change your work, what you want to learn) need no CV facts: give a sincere, specific, sensible view in the candidate's voice, tied to their real work and this job where it fits. Always answer these.
- Questions asking for an example or story: tell the closest real experience from the CV, using only what the CV says. Never add situations, deadlines, decisions, trade-offs, problems, people or reasons the CV doesn't mention. If the CV doesn't hold the story the question asks for, answer with an empty string so the candidate writes it. Never write that you have no example, no answer or no details.
- Plain, short, human and specific. No buzzwords, no clichés, no em dashes.
- Match the style of the candidate's past answers when given.
- Answer in the language the question is written in.
- Never mention salary, visa, sponsorship, notice period, location or personal details.
- Return only the answer text.
Placeholders like {{NAME}} stand for real values: keep them as they are.`;

function cvFacts(r: Resume): string {
  // Dates are included so "how many years of X?" can be answered from the CV.
  const work = r.work
    .slice(0, 6)
    .map(
      (w) =>
        `- ${w.position} at ${w.name} (${w.startDate ?? "?"} to ${w.endDate ?? "now"}): ${w.highlights.slice(0, 4).join("; ")}`,
    )
    .join("\n");
  const languages = r.languages
    .map((l) => (l.fluency ? `${l.language} (${l.fluency})` : l.language))
    .join(", ");
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
    languages ? `Languages: ${languages}` : "",
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

// ---------------------------------------------------------------- choice questions

const SYSTEM_CHOICES = `You answer multiple-choice questions on a job application for the candidate.
Rules:
- Use ONLY facts in the candidate's CV below. Today's date is given; compute years of experience from the job dates.
- For each question, return exactly one of its options, copied character for character.
- If the CV does not clearly support one option, answer "unsure". Never guess. Never assume skills or experience the CV doesn't show.
- Return JSON: {"answers": [{"n": 1, "answer": "..."}, ...]}.
Placeholders like {{NAME}} stand for real values: keep them as they are.`;

const choicesSchema = z.object({
  answers: z.array(z.object({ n: z.number().int(), answer: z.string() })),
});

/**
 * Picks answers for experience and skill choice questions (Yes/No, dropdowns) from the CV,
 * in one AI call. Personal and sensitive questions are filtered out before (aiMayChoose);
 * a pick that isn't exactly one of the options is dropped (validChoices). Null = unsure.
 */
export async function pickChoicesWithRouter(
  router: LlmRouter,
  userId: string,
  job: AnswerJob,
  cv: Resume,
  items: ChoiceQuestion[],
  personal: PersonalInfo,
): Promise<(string | null)[]> {
  const allowed = items.filter((i) => aiMayChoose(i.question) && i.options.length >= 2);
  if (allowed.length === 0) return items.map(() => null);
  const list = allowed
    .map(
      (i, n) => `${n + 1}. ${i.question}\n   Options: ${i.options.map((o) => `"${o}"`).join(", ")}`,
    )
    .join("\n");
  const result = await router.generateJson(
    "draft_answer",
    choicesSchema,
    `Today: ${new Date().toISOString().slice(0, 10)}
Job: ${job.title} at ${job.company_name}

The candidate's CV:
${cvFacts(cv)}

Questions:
${list}`,
    userId,
    { system: SYSTEM_CHOICES, personal },
  );
  const picks = validChoices(allowed, result.answers);
  return items.map((i) => {
    const k = allowed.indexOf(i);
    return k >= 0 ? (picks[k] ?? null) : null;
  });
}
