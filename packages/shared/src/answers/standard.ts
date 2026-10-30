// The owner's standing answers to personal questions an AI can't know from a CV. Applied by
// code (instant, always the same), never sent to an AI:
// - "Have you applied / interviewed here before?": No.
// - Travel, shifts, weekends, overtime, nights, office days, hybrid, on-site, commuting:
//   No, fully remote roles only.
// - Security clearance, criminal record, relatives or friends working there, conflicts of
//   interest, accommodations or adjustments, non-compete: No.
// - Consent tick boxes (privacy policy, terms, "I certify / agree / confirm"): ticked, for the
//   user to check before Submit. Marketing opt-ins are never ticked.

const APPLIED_BEFORE =
  /\b(have|did|had) you\b.{0,40}\b(previously |ever |already )?(applied|interviewed)\b|\bpreviously (applied|interviewed)\b|\bapplied (here|to us|with us|to this company) before\b/i;

const NOT_REMOTE =
  /\b(open|willing|able|comfortable|available|prepared|happy|ok|okay)\b.{0,40}\b(travel|commut|shifts?\b|weekends?|overtime|nights?\b|night shifts?|in[- ]?person|(the |our |an )?office|on-?site|onsite|hybrid)|\b(travel|commut\w*|work(ing)? (from|in) (the |our |an )?office|on-?site|in[- ]?person|hybrid|weekend|night|shift)\w*\b.{0,40}\b(required|requirement|expected)\b|\b(\d|one|two|three|four|five)\s+days?\s+(a|per|each)\s+week\b.{0,40}\b(office|on-?site|in[- ]?person)|\b(office|on-?site|in[- ]?person)\b.{0,40}\b(\d|one|two|three|four|five)\s+days?\s+(a|per|each)\s+week\b/i;

const ALWAYS_NO =
  /\b(security|government|federal|active|current|secret|top secret|sc|dv|nv1|nv2)\s*(security\s+)?clearance\b|\bclearance\b.{0,30}\b(hold|have|eligible|obtain)\b|\b(hold|have)\b.{0,30}\bclearance\b|\bcriminal\b|\bconvict(ed|ion)\b|\bfelon(y|ies)\b|\b(offen[cs]e|offen[cs]es)\b|\barrest(ed)?\b|\b(relative|family member|related to|spouse|partner|friend)s?\b.{0,60}\b(work|employ|current)|\bconflicts? of interest\b|\baccommodat(ion|ions|e)\b|\b(reasonable )?adjustments?\b|\bnon-?compete\b|\bnon-?solicit|\brestrictive covenant/i;

const CONSENT =
  /\b(i (have read|agree|consent|acknowledge|accept|certify|confirm|understand|declare|attest))\b|\bprivacy (policy|notice|statement)\b|\bterms (and|&) conditions\b|\bterms of (use|service)\b|\bdata (processing|protection)\b|\bgdpr\b|\bapplicant (privacy|consent)\b/i;

const MARKETING =
  /newsletter|marketing|promotion|job alerts?|similar (roles|jobs|positions)|future (opportunit|roles|jobs|vacanc)|talent (community|pool|network)|keep me (posted|informed|updated)|\bsms\b|text messages?|whatsapp|stay in touch/i;

export type StandardAnswer = {
  /** For Yes/No choices and dropdowns. */
  choice: string;
  /** For a text box. */
  text: string;
};

/** The owner's fixed answer to a personal question, or null when it isn't one of these. */
export function standardAnswer(question: string): StandardAnswer | null {
  if (APPLIED_BEFORE.test(question)) return { choice: "No", text: "No." };
  if (NOT_REMOTE.test(question)) {
    return { choice: "No", text: "No. I'm looking for fully remote roles only." };
  }
  if (ALWAYS_NO.test(question)) return { choice: "No", text: "No." };
  return null;
}

/** A consent tick box to tick for the user (never a marketing opt-in). */
export function isConsentBox(label: string): boolean {
  return CONSENT.test(label) && !MARKETING.test(label);
}
