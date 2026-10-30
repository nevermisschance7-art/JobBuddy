// Which sender domains belong to an employer, for matching its replies in Gmail.
// A job's own site counts (acme.com from careers.acme.com); applicant tracking systems and job
// boards don't (mail from greenhouse.io is matched by the company name instead). The bare slug
// of the name ("acmelabs") is added too: it matches a sender like jobs@acmelabs.io.

/** Hosts that send or host jobs for many companies. Matched by suffix. */
export const SHARED_JOB_HOSTS = [
  // Applicant tracking systems
  "greenhouse.io",
  "greenhouse-mail.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "workablemail.com",
  "myworkdayjobs.com",
  "myworkday.com",
  "workday.com",
  "smartrecruiters.com",
  "recruitee.com",
  "teamtailor.com",
  "teamtailor-mail.com",
  "bamboohr.com",
  "personio.de",
  "personio.com",
  "jobvite.com",
  "icims.com",
  "breezy.hr",
  "applytojob.com",
  "jazzhr.com",
  "pinpointhq.com",
  "rippling.com",
  "rippling-ats.com",
  "successfactors.com",
  "successfactors.eu",
  "taleo.net",
  "oraclecloud.com",
  "comeet.com",
  "comeet.co",
  "homerun.co",
  "join.com",
  "recruitcrm.io",
  "manatal.com",
  "zohorecruit.com",
  "zohorecruit.eu",
  "dover.com",
  "gem.com",
  // Boards and aggregators
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "google.com",
  "adzuna.com",
  "adzuna.co.uk",
  "jooble.org",
  "reed.co.uk",
  "remotive.com",
  "weworkremotely.com",
  "remoteok.com",
  "himalayas.app",
  "arbeitnow.com",
  "jobicy.com",
  "workingnomads.com",
  "lemon.io",
  "wellfound.com",
  "workatastartup.com",
  "ycombinator.com",
  "otta.com",
  "welcometothejungle.com",
  "builtin.com",
  "dice.com",
  "ziprecruiter.com",
  "monster.com",
  "stepstone.de",
  "remote.co",
  "landing.jobs",
];

export const LEGAL_SUFFIX_SOURCE = String.raw`\b(inc|incorporated|ltd|limited|llc|llp|gmbh|ag|sa|sas|sarl|srl|spa|bv|nv|plc|corp|corporation|co|company|oy|ab|as|aps|pty|sp z o o|s a|group|holdings?)\b`;
const LEGAL_SUFFIX = new RegExp(LEGAL_SUFFIX_SOURCE, "g");

/** Lower case, no legal suffix, single spaces: "Acme Labs, Inc." -> "acme labs". */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TWO_PART_TLD = /^(co|com|org|net|ac|gov|edu)$/;

/** acme.com from careers.acme.com, acme.co.uk from jobs.acme.co.uk. */
export function baseDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const keep = tld.length === 2 && TWO_PART_TLD.test(second) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

export const isSharedJobHost = (host: string) => {
  const h = host.toLowerCase();
  return SHARED_JOB_HOSTS.some((s) => h === s || h.endsWith(`.${s}`)) || /(^|\.)adzuna\./.test(h);
};

/** Employer domains for one application: own-site hosts of its URLs plus the name slug. */
export function employerDomains(company: string, urls: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const raw of urls) {
    if (!raw) continue;
    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      continue;
    }
    if (!host.includes(".") || isSharedJobHost(host)) continue;
    out.add(baseDomain(host));
  }
  const slug = normalizeCompany(company).replace(/ /g, "");
  if (slug.length >= 3) out.add(slug);
  return [...out];
}
