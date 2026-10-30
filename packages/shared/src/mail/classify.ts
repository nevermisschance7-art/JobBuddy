// Employer mail: is this good news, a rejection, a receipt or something else?
// Keyword rules only, no AI. The same RULES run in the user's Google Apps Script
// (see script.ts, which embeds them), so there is one source for both.
//
// Order: job alerts and newsletters are "other" first; a mail with no hiring words at all is
// "other"; then rejection (it wins over positive words: "unfortunately we will not move forward
// to the interview stage"), offer, assessment, interview, next step, receipt.
// Positive rules are written for direct statements ("we'd like to schedule", "your availability"),
// not for the "if your profile fits we will schedule an interview" lines that receipts carry.

export const MAIL_CLASSES = [
  "interview",
  "assessment",
  "offer",
  "next_step",
  "rejection",
  "received",
  "other",
] as const;
export type MailClass = (typeof MAIL_CLASSES)[number];

export const GOOD_NEWS = ["interview", "assessment", "offer", "next_step"] as const;
export type GoodNews = (typeof GOOD_NEWS)[number];

export const isGoodNews = (c: string): c is GoodNews =>
  (GOOD_NEWS as readonly string[]).includes(c);

/** Checked in this order after the alert and hiring checks; the first class with a match wins. */
export const MAIL_ORDER = [
  "rejection",
  "offer",
  "assessment",
  "interview",
  "next_step",
  "received",
] as const;

/** Regex sources, all used case-insensitively. Plain strings so the Apps Script can embed them. */
export const MAIL_RULES: Record<
  "job_alert" | "hiring" | "strong_subject" | (typeof MAIL_ORDER)[number],
  string[]
> = {
  // Checked against the sender and subject only.
  job_alert: [
    String.raw`jobalerts?-noreply@`,
    String.raw`jobs-(noreply|listings)@linkedin\.com`,
    String.raw`alert@indeed\.com`,
    String.raw`@(e\.|mail\.)?glassdoor\.com`,
    String.raw`@(mail\.|e\.)?(ziprecruiter|monster|dice|stepstone|totaljobs|jobsite)\.`,
    String.raw`\bjob alerts?\b`,
    String.raw`\bjobs? (you|that) (may|might) (like|be interested in)\b`,
    String.raw`\bnew jobs? (for you|matching|in|near|at)\b`,
    String.raw`\brecommended (jobs|roles|for you)\b`,
    String.raw`\band \d+ more jobs?\b`,
    String.raw`\b\d+\+? new [\w ]{0,40}jobs?\b`,
    String.raw`\bjobs? (digest|newsletter|roundup)\b`,
    String.raw`\bnewsletter\b`,
    String.raw`\bweekly (digest|roundup|update)\b`,
    String.raw`\btop jobs\b`,
    String.raw`Stellenangebote|Jobangebote f`,
    String.raw`offres d'emploi`,
    // Adverts from job sites (LinkedIn Premium trials and the like) are never news.
    String.raw`@(em|e|mail|news|info|marketing)\.linkedin\.com`,
    String.raw`\b(premium|free trial|your trial|upgrade (now|to)|subscription|webinar|% off|discount)\b`,
  ],
  // A receipt ("Thank you for applying") that only mentions a later test or call stays a
  // receipt, unless the subject itself says interview, schedule, test, offer or next step.
  strong_subject: [
    String.raw`\b(interview|schedule|scheduling|book(ing)? a|availability|assessment|test|challenge|assignment|offer|next steps?|call with|chat with|meet)\b`,
  ],
  // At least one must appear in sender, subject or body, or the mail is "other".
  hiring: [
    String.raw`greenhouse(-mail)?\.io|lever\.co|ashbyhq\.com|workable(mail)?\.com|myworkday(jobs)?\.com|workday\.com`,
    String.raw`smartrecruiters\.com|recruitee\.com|teamtailor(-mail)?\.com|bamboohr\.com|personio\.(de|com)`,
    String.raw`jobvite\.com|icims\.com|breezy\.hr|applytojob\.com|jazzhr\.com|pinpointhq\.com|rippling\.com|taleo\.net|successfactors|comeet\.|homerun\.co|join\.com`,
    String.raw`\bapplication`,
    String.raw`\bappl(y|ied|ying)\b`,
    String.raw`\bcandida(te|cy|tes|ture|tura|to)`,
    String.raw`\b(position|role|vacancy|opening|opportunity)\b`,
    String.raw`\brecruit`,
    String.raw`\bhiring\b`,
    String.raw`\binterview`,
    String.raw`\btalent\b`,
    String.raw`Bewerbung|Stelle\b|\bposte\b|\bpuesto\b|\bvaga\b|rekrutac|sollicitatie|entrevista|entretien|rozmow`,
  ],
  rejection: [
    String.raw`\bunfortunately\b`,
    String.raw`\bregret to (inform|let you know|tell you|say)\b`,
    String.raw`\b(not|won't|will not|aren't|are not|cannot|can't) (be )?(moving|move|going|proceed|proceeding) (forward|ahead)\b`,
    String.raw`\b(not|won't|will not) (be )?(progressing|proceeding|taking (your application|this|it) (any )?further)\b`,
    String.raw`\bdecided (not to (proceed|move forward|progress|pursue|continue)|to (proceed|move forward|go ahead|continue|pursue|progress)( \w+){0,3} with (other|another|a different) (candidate|applicant|profile)s?)`,
    String.raw`\bpursue other (candidates|applicants)\b`,
    String.raw`\b(position|role|vacancy|job|opening) (has|have) (now |already )?been (filled|closed)\b`,
    String.raw`\b(not|haven't|have not|weren't|were not) (been )?(selected|shortlisted|successful)\b`,
    String.raw`\bunsuccessful\b`,
    String.raw`\bno longer (under consideration|considering|being considered|available)\b`,
    String.raw`\b(not|isn't|is not) (the right|a) (fit|match)\b`,
    String.raw`\bwish you (the best|(all the )?best of luck|every success|success|luck|well) (in|with) your (job )?(search|future|career)`,
    String.raw`\bleider\b|\babsage\b|nicht (weiter )?ber(ü|ue)cksichtig`,
    String.raw`\bmalheureusement\b|ne (pas|pouvons pas|pourrons pas) donner (une )?suite`,
    String.raw`\blamentablemente\b|\bdesafortunadamente\b|\bno (hemos podido|podemos) (seguir|continuar)`,
    String.raw`\bniestety\b|\bhelaas\b|\bpurtroppo\b|\binfelizmente\b`,
  ],
  offer: [
    String.raw`\boffer letter\b`,
    String.raw`\boffer of employment\b`,
    String.raw`\b(pleased|happy|delighted|excited|thrilled|glad) to (formally )?offer you\b`,
    String.raw`\b(extend|extending|make|making) (you )?(an|a formal|a written|a verbal|our|the) (job )?offer\b`,
    String.raw`\b(verbal|formal|written) offer\b`,
    String.raw`\byour (job )?offer (package|details|letter)\b`,
    String.raw`Vertragsangebot|proposition d'embauche|oferta de (trabajo|empleo)|propozycj[aę] (pracy|zatrudnienia)`,
  ],
  assessment: [
    String.raw`hackerrank\.com|codility\.com|testgorilla\.com|codesignal\.com|coderbyte\.com|hackerearth\.com`,
    String.raw`devskiller\.com|testdome\.com|codingame\.com|coderpad\.io|qualified\.io|canditech|vervoe\.com|alooba\.com|hirevue\.com|willo\.video`,
    String.raw`\bhackerrank\b|\bcodility\b|\btestgorilla\b|\bcodesignal\b`,
    String.raw`\btake[- ]home\b`,
    String.raw`\b(complete|take|start|begin|access) (the|a|an|our|your|this) (short |online |technical |coding |skills? )?(assessment|test|challenge|exercise|assignment|task)\b`,
    String.raw`\b(invite|invited|inviting|invitation) (you )?to (complete|take) (the|a|an|our)\b`,
    String.raw`\b(assessment|test|challenge) (invitation|invite|link)\b`,
    String.raw`\bcoding (challenge|exercise|assignment)\b`,
  ],
  interview: [
    String.raw`calendly\.com|goodtime\.io|cal\.com/|savvycal\.com|youcanbook\.me|chilipiper\.com|zcal\.co|calendar\.app\.google|doodle\.com|meetings\.hubspot\.com`,
    String.raw`\bbook (a|your|an) (time|slot|call|interview|meeting)\b`,
    String.raw`\b(pick|choose|select) (a|your) (time|slot|date)\b`,
    String.raw`(?<!\bto )(?<!will )(?<!'ll )\bschedule (a|an|your) (call|chat|interview|meeting|time|conversation)\b`,
    String.raw`\b(like|love|want|happy|glad|pleased) to (schedule|set up|arrange|book|invite you)\b`,
    String.raw`\b(please|kindly) (schedule|book|select|choose|pick|let (us|me) know your|share your|send (us|me) your|reply with your)\b`,
    String.raw`\b(let's|let us|can we|could we|shall we) (schedule|set up|find a time|arrange|book|have a (call|chat))\b`,
    String.raw`\byour availability\b`,
    String.raw`\bwhen (are|would) you (be )?(available|free)\b`,
    String.raw`\bwhat times? (works?|suits?) (best )?for you\b`,
    String.raw`\b(would|are) you (be )?available\b`,
    String.raw`\binvit(e|ing|ation) (you )?(to|for) (an? |the |your )?(\w+ )?(interview|call|chat|conversation|meeting|screen)`,
    String.raw`\binterview (invitation|invite|request)\b`,
    String.raw`\binterview (is |has been )?(scheduled|confirmed|booked)\b`,
    String.raw`\b(confirm|confirming|confirmed|confirmation of) (your|the) interview\b`,
    String.raw`\byour interview (with|at|on)\b`,
    String.raw`Einladung zu(m)? (einem )?(Gespr|Interview|Vorstellungsgespr)|Vorstellungsgespr(ä|ae)ch (am|vereinbaren)`,
    String.raw`invitation (à|a|pour) (un )?entretien|invitaci(ó|o)n (a|para) (una )?entrevista|zaproszenie na rozmow|uitnodiging voor (een )?(sollicitatie)?gesprek`,
  ],
  next_step: [
    String.raw`\b(move|moving|progress|progressing|advance|advancing|invite|inviting) (you|your application|your candidacy) (forward |on |ahead )?(to|into) the next (stage|step|round|phase)\b`,
    String.raw`\b(like|love|happy|pleased|excited|delighted|glad) to (move|progress|advance|proceed|continue) (forward |ahead )?with (you|your application|your candidacy)\b`,
    String.raw`(?<!\bif )\byou('ve| have) been (shortlisted|selected for|moved (forward|to the next))`,
    String.raw`\b(pleased|happy|excited|delighted|glad|thrilled) to (let you know|inform you|tell you|share) that\b(?! (we('ve| have)? )?(received|got)\b| your application (has been |was )?(received|submitted)\b)`,
    String.raw`\bimpressed (with|by) your (background|profile|application|experience)\b`,
    String.raw`\b(would|'d) (like|love) to (learn|hear|know) more about you\b`,
    String.raw`\b(would|'d) (like|love) to (speak|talk|chat|meet|connect) with you\b`,
    String.raw`\byour application (was|has been|is) successful\b`,
  ],
  received: [
    String.raw`\bthank(s| you) (so much |very much )?for (applying|your application|your interest|submitting)`,
    String.raw`\b(we('ve| have)? )?(successfully )?received your application\b`,
    String.raw`\bapplication (has been |was |is )?(received|submitted|sent|complete)\b`,
    String.raw`\bapplication confirmation\b`,
    String.raw`\b(confirm|confirming|acknowledge) (the )?receipt\b`,
    String.raw`Bewerbung (ist )?(eingegangen|erhalten)|Eingangsbest(ä|ae)tigung|Dank f(ü|ue)r (Ihre|deine) Bewerbung`,
    String.raw`merci (pour|de) votre candidature|candidature (a bien été )?re(ç|c)ue`,
    String.raw`gracias por (tu|su) (solicitud|candidatura|postulaci(ó|o)n|inter(é|e)s)`,
    String.raw`dzi(ę|e)kujemy za (aplikacj|zg(ł|l)oszenie|przes(ł|l)anie)|bedankt voor (je|uw) sollicitatie|obrigad[oa] pela (sua )?candidatura|grazie per (la tua|la sua|aver)`,
  ],
};

export type MailInput = { from: string; subject: string; body: string };

const compiled = Object.fromEntries(
  Object.entries(MAIL_RULES).map(([k, list]) => [k, list.map((s) => new RegExp(s, "i"))]),
) as Record<keyof typeof MAIL_RULES, RegExp[]>;

const any = (list: RegExp[], text: string) => list.some((r) => r.test(text));

/** The class of one mail. Pure; the Apps Script copy must give the same answers (tested). */
export function classifyMail({ from, subject, body }: MailInput): MailClass {
  const head = `${from}\n${subject}`;
  const text = `${subject}\n${body}`;
  if (any(compiled.job_alert, head)) return "other";
  if (!any(compiled.hiring, `${from}\n${text}`)) return "other";
  for (const c of MAIL_ORDER) {
    if (!any(compiled[c], text)) continue;
    if (
      isGoodNews(c) &&
      any(compiled.received, subject) &&
      !any(compiled.strong_subject, subject)
    ) {
      return "received";
    }
    return c;
  }
  return "other";
}
