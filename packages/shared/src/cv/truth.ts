import type { Resume } from "../resume";
import { TECH_SYNONYMS, TECH_TERMS } from "./tech-terms";

// The truth checker: code, not AI. A tailored CV may only select, reorder and reword facts from
// the confirmed CV. Anything else is removed (or, for dates and titles, restored from the
// source) and recorded, so the user sees exactly what was taken out and why.

export type TruthIssue = { section: string; item: string; reason: string };

export type TruthReport = {
  removed: TruthIssue[];
  corrected: TruthIssue[];
  /** Technologies the job asks for that the CV doesn't show. Shown to the user, never added. */
  gaps: string[];
};

// ---------------------------------------------------------------- technologies

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TERM_PATTERNS: [string, RegExp][] = [
  ...new Set([...TECH_TERMS, ...Object.keys(TECH_SYNONYMS)]),
].map((t) => [t, new RegExp(`(?<![a-z0-9+#.])${escape(t)}(?![a-z0-9+#])`, "i")]);

export function canonicalTerm(term: string): string {
  const t = term.trim().toLowerCase();
  return TECH_SYNONYMS[t] ?? t;
}

/** Known technologies mentioned in a text, in canonical form. */
export function termsIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const [term, re] of TERM_PATTERNS) if (re.test(text)) found.add(canonicalTerm(term));
  return found;
}

// ---------------------------------------------------------------- numbers

const NUMBER =
  /(\d[\d,]*(?:\.\d+)?)\s*(%|percent|k\b|m\b|bn\b|b\b|x\b|million|billion|thousand|\+)?/gi;

/** Numbers in a text, normalised: "2 million" and "2M" are both "2m"; "60 percent" is "60%". */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(NUMBER)) {
    const value = (m[1] ?? "").replace(/,/g, "");
    let unit = (m[2] ?? "").toLowerCase();
    unit =
      { percent: "%", million: "m", billion: "b", bn: "b", thousand: "k", "+": "" }[unit] ?? unit;
    out.add(value + unit);
  }
  return out;
}

// ---------------------------------------------------------------- helpers

const norm = (s: string | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function resumeText(r: Resume): string {
  return JSON.stringify(r);
}

type Facts = { text: string; terms: Set<string>; numbers: Set<string>; skills: Set<string> };

function factsOf(source: Resume): Facts {
  const text = resumeText(source);
  const skills = new Set<string>();
  for (const g of source.skills) for (const k of g.keywords) skills.add(canonicalTerm(k));
  for (const p of source.projects) for (const k of p.keywords) skills.add(canonicalTerm(k));
  return { text: text.toLowerCase(), terms: termsIn(text), numbers: numbersIn(text), skills };
}

/** Why a piece of text can't be used: an invented technology or number. Null when fine. */
function problemIn(text: string, facts: Facts): string | null {
  const terms = [...termsIn(text)].filter((t) => !facts.terms.has(t) && !facts.skills.has(t));
  if (terms.length > 0) return `Mentions ${terms.join(", ")}, which is not in your CV`;
  const numbers = [...numbersIn(text)].filter((n) => !facts.numbers.has(n));
  if (numbers.length > 0) return `Uses the number ${numbers.join(", ")}, which is not in your CV`;
  return null;
}

const clip = (s: string) => (s.length > 90 ? `${s.slice(0, 87)}...` : s);

// ---------------------------------------------------------------- the check

/**
 * Returns a version of `tailored` that only contains facts from `source`, plus a report.
 * Contact details and headline always come from the source.
 */
export function checkTailoredCv(
  source: Resume,
  tailored: Resume,
  jobText = "",
): { resume: Resume; report: TruthReport } {
  const facts = factsOf(source);
  const report: TruthReport = { removed: [], corrected: [], gaps: [] };

  // Summary: AI-written, so it must not bring in new technologies or numbers.
  let summary = tailored.basics.summary;
  const summaryProblem = summary ? problemIn(summary, facts) : null;
  if (summary && summaryProblem) {
    report.removed.push({ section: "Summary", item: clip(summary), reason: summaryProblem });
    summary = source.basics.summary;
  }
  const basics = { ...source.basics, summary };

  const checkBullets = (section: string, bullets: string[]) =>
    bullets.filter((b) => {
      const problem = problemIn(b, facts);
      if (problem) report.removed.push({ section, item: clip(b), reason: problem });
      return !problem;
    });

  const work = tailored.work.flatMap((w) => {
    const candidates = source.work.filter((s) => norm(s.name) === norm(w.name));
    const original = candidates.find((s) => norm(s.position) === norm(w.position)) ?? candidates[0];
    if (!original) {
      report.removed.push({
        section: "Experience",
        item: `${w.position} at ${w.name}`,
        reason: "This employer is not in your CV",
      });
      return [];
    }
    const label = `${original.position} at ${original.name}`;
    if (norm(w.position) !== norm(original.position)) {
      report.corrected.push({
        section: "Experience",
        item: label,
        reason: `Job title changed to "${w.position}", restored`,
      });
    }
    if (
      (w.startDate ?? "") !== (original.startDate ?? "") ||
      (w.endDate ?? "") !== (original.endDate ?? "")
    ) {
      report.corrected.push({
        section: "Experience",
        item: label,
        reason: "Dates changed, restored",
      });
    }
    return [
      {
        ...original,
        summary: w.summary && !problemIn(w.summary, facts) ? w.summary : original.summary,
        highlights: checkBullets(`Experience: ${label}`, w.highlights),
      },
    ];
  });

  const education = tailored.education.flatMap((e) => {
    const original = source.education.find((s) => norm(s.institution) === norm(e.institution));
    if (!original) {
      report.removed.push({ section: "Education", item: e.institution, reason: "Not in your CV" });
      return [];
    }
    if (
      (e.startDate ?? "") !== (original.startDate ?? "") ||
      (e.endDate ?? "") !== (original.endDate ?? "")
    ) {
      report.corrected.push({
        section: "Education",
        item: original.institution,
        reason: "Dates changed, restored",
      });
    }
    return [original];
  });

  const knownSkill = (k: string) => {
    const c = canonicalTerm(k);
    const word = new RegExp(`(?<![a-z0-9+#.])${escape(k.trim().toLowerCase())}(?![a-z0-9+#])`);
    return facts.skills.has(c) || facts.terms.has(c) || word.test(facts.text);
  };
  const keepSkills = (section: string, keywords: string[]) =>
    keywords.filter((k) => {
      const ok = knownSkill(k);
      if (!ok) report.removed.push({ section, item: k, reason: "Skill not in your CV" });
      return ok;
    });
  const skills = tailored.skills
    .map((g) => ({
      ...g,
      name: problemIn(g.name, facts) ? "Skills" : g.name,
      keywords: keepSkills("Skills", g.keywords),
    }))
    .filter((g) => g.keywords.length > 0);

  const projects = tailored.projects.flatMap((p) => {
    const original = source.projects.find((s) => norm(s.name) === norm(p.name));
    if (!original) {
      report.removed.push({
        section: "Projects",
        item: p.name,
        reason: "This project is not in your CV",
      });
      return [];
    }
    return [
      {
        ...original,
        description:
          p.description && !problemIn(p.description, facts) ? p.description : original.description,
        highlights: checkBullets(`Project: ${original.name}`, p.highlights),
        keywords: keepSkills(`Project: ${original.name}`, p.keywords),
      },
    ];
  });

  const keepNamed = <T extends { language?: string; name?: string }>(
    items: T[],
    from: T[],
    key: "language" | "name",
  ) => items.filter((i) => from.some((s) => norm(s[key]) === norm(i[key])));

  report.gaps = [...termsIn(jobText)]
    .filter((t) => !facts.terms.has(t) && !facts.skills.has(t))
    .sort();

  return {
    resume: {
      ...tailored,
      basics,
      work,
      education,
      skills,
      projects,
      languages: keepNamed(tailored.languages, source.languages, "language"),
      certificates: keepNamed(tailored.certificates, source.certificates, "name"),
    },
    report,
  };
}
