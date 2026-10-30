// A short cover letter per job, from the confirmed CV only. The AI writes the body; the code
// adds the greeting and sign-off and checks it like a tailored CV (no technology or number
// that isn't in the CV). Without an AI, or when the check fails, ruleCoverLetter writes one
// from the CV's own facts.

import type { Resume } from "../resume";
import { ruleTailor } from "./tailor-plan";
import { careerYears, termsIn, unsupportedIn } from "./truth";

export type LetterJob = { title: string; company_name: string; description_text: string };

export const COVER_LETTER_WORDS = 220;

export const COVER_LETTER_SYSTEM = `You write the body of a short cover letter for one job, as the candidate ("I").
- 3 short paragraphs, ${COVER_LETTER_WORDS} words at most in total. No greeting, no sign-off, no address or date: only the paragraphs.
- Paragraph 1: the role and why this candidate fits, in one or two sentences.
- Paragraph 2: two or three concrete things from the CV that match what the job asks for (real results and technologies from the CV).
- Paragraph 3: one sentence on why this company or work interests them, and that they'd like to talk.
- Only facts from the CV. Never invent experience, employers, numbers, skills or technologies.
- Plain, warm and specific. No buzzwords, no clichés ("I am writing to express"), no em dashes.
- Never mention salary, visa, sponsorship, notice period or location.
Placeholders like {{NAME}} stand for real values: keep them as they are.`;

export function coverLetterPrompt(cv: Resume, job: LetterJob, facts: string): string {
  return `Job: ${job.title} at ${job.company_name}
Job description (shortened):
"""
${job.description_text.slice(0, 3000)}
"""

The candidate's CV:
${facts}

Write the cover letter body.`;
}

/** Greeting, the body's paragraphs, sign-off. */
export function wrapLetter(body: string, cv: Resume, job: LetterJob): string {
  const paragraphs = body
    .replace(/\r/g, "")
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    // A greeting or sign-off the AI added anyway.
    .filter((p) => p && !/^(dear|hi|hello)\b.{0,60},?$/i.test(p))
    .filter(
      (p) => !/^(kind regards|best regards|regards|sincerely|best|thanks|thank you),?$/i.test(p),
    )
    .filter((p) => p !== cv.basics.name);
  const company = job.company_name.trim();
  return [
    company ? `Dear ${company} hiring team,` : "Dear hiring team,",
    ...paragraphs,
    `Kind regards,\n${cv.basics.name}`,
  ].join("\n\n");
}

/** The AI's body passes when it brings in no technology or number the CV doesn't have. */
export function letterProblems(body: string, cv: Resume): string[] {
  return unsupportedIn(body, cv);
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
const sentence = (s: string) => {
  const t = s.trim().replace(/[.;:,]+$/, "");
  return t ? `${t}.` : "";
};

/** A letter from the CV's own facts, ordered for the job (no AI). */
export function ruleCoverLetter(cv: Resume, job: LetterJob): string {
  const tailored = ruleTailor(cv, job.title, job.description_text);
  const jobTerms = termsIn(`${job.title}\n${job.description_text}`);
  const matching = tailored.skills
    .flatMap((g) => g.keywords)
    .filter((k) => [...termsIn(k)].some((t) => jobTerms.has(t)))
    .slice(0, 4);
  const years = careerYears(cv);
  const role = cv.basics.label?.split(/[·|,(]/)[0]?.trim() || cv.work[0]?.position || "developer";
  const recent = tailored.work.find((w) => w.highlights.length > 0);

  const opening =
    `I'm applying for the ${job.title} role at ${job.company_name}. ` +
    `I'm a ${role}${years >= 2 ? ` with ${years} years of experience` : ""}` +
    (matching.length ? `, working with ${listOf(matching)}.` : ".");
  const proof = recent
    ? `At ${recent.name}, I ${recent.highlights
        .slice(0, 2)
        .map((h) => lowerFirst(sentence(h)).replace(/\.$/, ""))
        .join(", and ")}.`
    : "";
  const close = `I'd welcome the chance to talk about how I could help ${job.company_name}.`;
  return wrapLetter([opening, proof, close].filter(Boolean).join("\n\n"), cv, job);
}

function listOf(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
