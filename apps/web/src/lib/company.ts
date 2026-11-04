/** One key per company, so "Acme Inc." and "ACME" match: lower case, no legal suffix. */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(
      /\b(inc|incorporated|ltd|limited|llc|gmbh|ag|bv|sa|sas|plc|corp|corporation|co)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** A job the user applied to recently: which, when, and the words of its ad (to compare). */
export type AppliedBefore = { jobId: string; title: string; appliedAt: string; words: string[] };

const wordsOf = (text: string, min: number) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((w) => w.length >= min),
  );

/** The distinctive words of a job ad (its first part), to tell the same ad posted twice. */
export function adWords(description: string): string[] {
  return [...wordsOf(description.slice(0, 1500), 4)].slice(0, 150);
}

/**
 * The same job posted twice (another board, or reposted): same company (the caller groups by
 * companyKey), nearly the same title and mostly the same ad. A different role at the same
 * company is not the same job.
 */
export function sameJob(
  applied: AppliedBefore,
  job: { id: string; title: string; description: string },
): boolean {
  if (applied.jobId === job.id) return true;
  const a = wordsOf(applied.title, 2);
  const b = wordsOf(job.title, 2);
  const shared = [...a].filter((w) => b.has(w)).length;
  if (shared / Math.max(1, new Set([...a, ...b]).size) < 0.8) return false;
  const mine = new Set(adWords(job.description));
  const overlap = applied.words.filter((w) => mine.has(w)).length;
  return overlap / Math.max(1, Math.min(applied.words.length, mine.size)) >= 0.5;
}
