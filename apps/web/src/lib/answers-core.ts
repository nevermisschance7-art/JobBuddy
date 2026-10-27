import {
  answerQuestions,
  type DraftedAnswer,
  type DraftInput,
  type PastAnswer,
  type Resume,
} from "@jobbuddy/shared";
import type { LlmRouter, PersonalInfo } from "@jobbuddy/shared/llm";

// Pure (no server-only imports) so the AI check workflow can run it against real models.

export type AnswerJob = { title: string; company_name: string; description_text: string };

/** What the board stores in applications.answers: the draft plus the user's final text. */
export type StoredAnswer = DraftedAnswer & { final?: string };

const SYSTEM = `You write a job application answer for the candidate, as the candidate ("I").
Rules:
- Only use facts from the candidate's CV below. Never invent experience, numbers, employers or skills.
- Plain, short, human and specific. No buzzwords, no clichés, no em dashes.
- Match the style of the candidate's past answers when given.
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
    adapt: (answer, question) =>
      router.generateText(
        "draft_answer",
        `The candidate answered a very similar question before. Adapt their answer to this job with as few changes as possible: keep their words, only fix names of the company or role.

Job: ${job.title} at ${job.company_name}
Question: ${question}
Their past answer:
"""
${answer}
"""`,
        Math.max(40, answer.split(/\s+/).length + 10),
        userId,
        { system: SYSTEM, personal },
      ),
  });
}
