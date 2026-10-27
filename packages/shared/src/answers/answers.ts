// Application answers. Order for each question:
// 1. Sensitive (right to work, sponsorship, salary, notice, relocation, location, links,
//    demographics): the user's fixed answer only, never an AI. Missing: ask the user.
// 2. A very similar question answered before: reuse the user's final answer ("Reused, check this").
// 3. Otherwise the AI drafts it, using past answers as style examples.
// This module is pure (the AI call is passed in) so the rules above are easy to test.

export type FixedKey =
  | "right_to_work"
  | "visa_status"
  | "needs_sponsorship"
  | "notice_period"
  | "salary_expectation"
  | "willing_to_relocate"
  | "location"
  | "pronouns"
  | "demographics"
  | "linkedin_url"
  | "github_url"
  | "portfolio_url";

// Checked in order; the first match wins. Sponsorship before right to work, since
// "Will you require sponsorship for the right to work?" should map to sponsorship.
const FIXED_RULES: [FixedKey, RegExp][] = [
  ["needs_sponsorship", /sponsor/i],
  ["visa_status", /\b(visa|immigration|citizen(ship)?|nationality|work permit)\b/i],
  [
    "right_to_work",
    /(right|authori[sz]ed|eligible|legally (able|allowed|permitted)) to work|work authori[sz]ation/i,
  ],
  [
    "salary_expectation",
    /salary|compensation|pay expectation|expected pay|desired pay|rate expectation|day rate|hourly rate/i,
  ],
  [
    "notice_period",
    /notice period|when can you start|start date|earliest .*start|availability to start|how soon/i,
  ],
  ["willing_to_relocate", /relocat/i],
  ["pronouns", /pronoun/i],
  [
    "demographics",
    /\b(gender|sex|ethnic(ity)?|race|racial|disab(led|ility)|veteran|sexual orientation|transgender|religio(n|us)|age range|date of birth|hispanic|latino)\b/i,
  ],
  ["linkedin_url", /linked\s?in/i],
  ["github_url", /git\s?hub/i],
  ["portfolio_url", /portfolio|personal (web)?site|website/i],
  [
    "location",
    /where are you (currently |now )?(based|located|living)|current (location|city|country)|country of residence|which (city|country)|time ?zone|located in|reside in|based in/i,
  ],
];

/** The fixed answer this question needs, or null when it may be drafted. */
export function fixedKeyFor(question: string): FixedKey | null {
  for (const [key, re] of FIXED_RULES) if (re.test(question)) return key;
  return null;
}

// ---------------------------------------------------------------- similarity

const STOP = new Set(
  "a an the and or of to for in on at with you your we our us is are be do does did this that it as by from what why how which would could can will please tell describe".split(
    " ",
  ),
);

function tokens(text: string, company?: string): string[] {
  let t = text.toLowerCase();
  if (company) t = t.split(company.toLowerCase()).join(" company ");
  return t
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
}

function vector(words: string[]): Map<string, number> {
  const v = new Map<string, number>();
  const add = (k: string) => v.set(k, (v.get(k) ?? 0) + 1);
  words.forEach((w, i) => {
    add(w);
    if (i > 0) add(`${words[i - 1]} ${w}`);
  });
  return v;
}

/** Cosine similarity of two questions over words and word pairs (0 to 1). */
export function questionSimilarity(
  a: string,
  b: string,
  companyA?: string,
  companyB?: string,
): number {
  const va = vector(tokens(a, companyA));
  const vb = vector(tokens(b, companyB));
  if (va.size === 0 || vb.size === 0) return 0;
  let dot = 0;
  for (const [k, x] of va) dot += x * (vb.get(k) ?? 0);
  const norm = (v: Map<string, number>) =>
    Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
  return dot / (norm(va) * norm(vb));
}

/** At or above this, a past answer is reused instead of drafting a new one. */
export const REUSE_THRESHOLD = 0.88;

// ---------------------------------------------------------------- word limits

export const DEFAULT_MAX_WORDS = 80;
export const COVER_LETTER_MAX_WORDS = 180;

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Reads a limit written in the question: "(max 100 words)", "in 50 words or fewer", "500 characters". */
export function wordLimitIn(question: string): number | null {
  const words = /(\d{1,4})\s*words?/i.exec(question);
  if (words) return Number(words[1]);
  const chars = /(\d{2,5})\s*char(acter)?s?/i.exec(question);
  if (chars) return Math.max(10, Math.floor(Number(chars[1]) / 6.5));
  return null;
}

/** Splits pasted text into questions: one per line (blank lines and bullets ignored). */
export function splitQuestions(pasted: string): string[] {
  return pasted
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim())
    .filter((l) => l.length > 2)
    .slice(0, 30);
}

// ---------------------------------------------------------------- drafting

export type AnswerKind = "fixed" | "missing_fixed" | "reused" | "drafted" | "failed";

export type DraftedAnswer = {
  question: string;
  kind: AnswerKind;
  answer: string;
  maxWords: number;
  fixedKey?: FixedKey;
  /** For reused answers: the past question it came from. */
  reusedFrom?: string;
  overLimit?: boolean;
  isCoverLetter?: boolean;
  /** Technologies or numbers in an AI draft that the CV doesn't contain. */
  unsupported?: string[];
};

export type PastAnswer = { question: string; answer: string; company?: string | null };

export type DraftInput = {
  question: string;
  maxWords: number;
  /** The user's most similar past final answers, as style examples. */
  examples: PastAnswer[];
  isCoverLetter: boolean;
};

export type DraftDeps = {
  fixedAnswers: Partial<Record<string, string>>;
  memory: PastAnswer[];
  company: string;
  /** Drafts one answer with the AI (the cover letter, or every answer without draftMany). */
  draft: (input: DraftInput) => Promise<{ text: string }>;
  /**
   * Drafts several answers in ONE AI call, in order. Saves free-tier quota: a whole form
   * costs one request. Never receives fixed answers.
   */
  draftMany?: (inputs: DraftInput[]) => Promise<string[]>;
  /** Lists claims in a draft that the CV doesn't support (see unsupportedIn). */
  check?: (text: string) => string[];
  /** Most AI drafts in one call, so a long form fits in one web request. Default 12. */
  maxDrafts?: number;
};

/** A past answer for another company, with that company's name changed to this one. */
export function adaptAnswer(answer: string, from: string | null | undefined, to: string): string {
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return answer;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return answer.replace(new RegExp(`\\b${escaped}\\b`, "gi"), to);
}

type Pending = { index: number; input: DraftInput };

export async function answerQuestions(
  questions: { text: string; coverLetter?: boolean }[],
  deps: DraftDeps,
): Promise<DraftedAnswer[]> {
  const out: DraftedAnswer[] = new Array(questions.length);
  const pending: Pending[] = [];
  let budget = deps.maxDrafts ?? 12;

  questions.forEach((q, index) => {
    const isCoverLetter = Boolean(q.coverLetter);
    const maxWords = isCoverLetter
      ? COVER_LETTER_MAX_WORDS
      : (wordLimitIn(q.text) ?? DEFAULT_MAX_WORDS);
    const base = { question: q.text, maxWords, ...(isCoverLetter ? { isCoverLetter } : {}) };

    // 1. Sensitive: the user's fixed answer only, never an AI.
    const key = isCoverLetter ? null : fixedKeyFor(q.text);
    if (key) {
      const value = deps.fixedAnswers[key]?.trim();
      out[index] = value
        ? { ...base, kind: "fixed", fixedKey: key, answer: value }
        : { ...base, kind: "missing_fixed", fixedKey: key, answer: "" };
      return;
    }

    // 2. Answered before: the user's own words, with the company name swapped.
    const ranked = deps.memory
      .map((m) => ({
        m,
        score: questionSimilarity(q.text, m.question, deps.company, m.company ?? undefined),
      }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!isCoverLetter && best && best.score >= REUSE_THRESHOLD) {
      const answer = adaptAnswer(best.m.answer, best.m.company, deps.company);
      out[index] = {
        ...base,
        kind: "reused",
        answer,
        reusedFrom: best.m.question,
        overLimit: countWords(answer) > maxWords,
      };
      return;
    }

    // 3. The AI drafts it. Over the limit: left for the user to draft again or write.
    if (budget-- <= 0) {
      out[index] = { ...base, kind: "failed", answer: "" };
      return;
    }
    const examples = ranked.slice(0, 5).map((r) => r.m);
    pending.push({ index, input: { question: q.text, maxWords, examples, isCoverLetter } });
  });

  const done = (p: Pending, text: string | null) => {
    const base = {
      question: p.input.question,
      maxWords: p.input.maxWords,
      ...(p.input.isCoverLetter ? { isCoverLetter: true } : {}),
    };
    if (!text?.trim()) {
      out[p.index] = { ...base, kind: "failed", answer: "" };
      return;
    }
    const unsupported = deps.check?.(text) ?? [];
    out[p.index] = {
      ...base,
      kind: "drafted",
      answer: text.trim(),
      overLimit: countWords(text) > p.input.maxWords,
      ...(unsupported.length > 0 ? { unsupported } : {}),
    };
  };

  const one = async (p: Pending) => {
    try {
      done(p, (await deps.draft(p.input)).text);
    } catch {
      done(p, null);
    }
  };

  const answers = pending.filter((p) => !p.input.isCoverLetter);
  const letters = pending.filter((p) => p.input.isCoverLetter);
  const batch = async () => {
    if (answers.length === 0) return;
    if (!deps.draftMany || answers.length === 1) {
      await Promise.all(answers.map(one));
      return;
    }
    try {
      const texts = await deps.draftMany(answers.map((p) => p.input));
      answers.forEach((p, i) => done(p, texts[i] ?? null));
    } catch {
      answers.forEach((p) => done(p, null));
    }
  };
  await Promise.all([batch(), ...letters.map(one)]);
  return out;
}
