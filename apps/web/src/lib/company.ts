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

/** A company the user applied to recently: the job and when. */
export type AppliedBefore = { jobId: string; title: string; appliedAt: string };
