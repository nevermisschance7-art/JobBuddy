// Which job an application page belongs to, from its URL. Shared by the extension (is this
// an application page?) and the web app (find the stored job).

export type AtsName = "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters";

export type JobKey = {
  ats: AtsName;
  /** A distinctive part of the job's URL (numeric id, uuid or shortcode), lower case. */
  id: string;
};

/** Hosts the extension runs on. Keep in sync with the manifest's content script matches. */
export const ATS_HOSTS: Record<AtsName, string[]> = {
  greenhouse: [
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "job-boards.eu.greenhouse.io",
    "boards.eu.greenhouse.io",
  ],
  lever: ["jobs.lever.co", "jobs.eu.lever.co"],
  ashby: ["jobs.ashbyhq.com"],
  workable: ["apply.workable.com"],
  smartrecruiters: ["jobs.smartrecruiters.com"],
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function atsForHost(host: string): AtsName | null {
  const h = host.toLowerCase();
  for (const [ats, hosts] of Object.entries(ATS_HOSTS) as [AtsName, string[]][]) {
    if (hosts.includes(h)) return ats;
  }
  return null;
}

/** The job behind an application page URL, or null when it isn't one we know. */
export function jobKeyFromUrl(raw: string): JobKey | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const params = url.searchParams;
  // Greenhouse embedded on a company site: ?gh_jid=123, or the embed frame's ?token=123.
  const ghId =
    params.get("gh_jid") ?? (url.pathname.includes("/embed/job_app") ? params.get("token") : null);
  if (ghId && /^\d+$/.test(ghId)) return { ats: "greenhouse", id: ghId };

  const ats = atsForHost(url.hostname);
  if (!ats) return null;
  const parts = url.pathname.split("/").filter(Boolean);

  switch (ats) {
    case "greenhouse": {
      // /acme/jobs/123
      const i = parts.indexOf("jobs");
      const id = i >= 0 ? parts[i + 1] : undefined;
      return id && /^\d+$/.test(id) ? { ats, id } : null;
    }
    case "lever":
    case "ashby": {
      // /acme/<uuid>[/apply|/application]
      const id = url.pathname.match(UUID)?.[0];
      return id ? { ats, id: id.toLowerCase() } : null;
    }
    case "workable": {
      // /acme/j/ABC123DEF/[apply]
      const i = parts.indexOf("j");
      const id = i >= 0 ? parts[i + 1] : undefined;
      return id ? { ats, id: id.toLowerCase() } : null;
    }
    case "smartrecruiters": {
      // Apply form: /oneclick-ui/company/Acme/publication/<uuid>
      if (parts[0] === "oneclick-ui") {
        const uuid = url.pathname.match(UUID)?.[0];
        return uuid ? { ats, id: uuid.toLowerCase() } : null;
      }
      // Job page: /Acme/744000012345678-backend-engineer[/apply]
      const id = parts[1]?.match(/^(\d{6,})/)?.[1];
      return id ? { ats, id } : null;
    }
  }
}

/** A page address without query or fragment, to match jobs on any site by URL. */
export function pageAddress(raw: string): string | null {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Other application systems where the extension offers itself without being asked (the box
 * shows only when a form is on the page). Matched as the host or any subdomain of it.
 * Keep in sync with the manifest (built from this list).
 */
export const FORM_HOSTS = [
  "myworkdayjobs.com",
  "myworkdaysite.com",
  "icims.com",
  "bamboohr.com",
  "breezy.hr",
  "recruitee.com",
  "teamtailor.com",
  "jobs.personio.de",
  "jobs.personio.com",
  "applytojob.com",
  "jobvite.com",
  "smartrecruiters.com",
  "workable.com",
  "join.com",
  "pinpointhq.com",
  "comeet.com",
  "freshteam.com",
  "homerun.co",
  "dover.com",
  "rippling.com",
];

export function isFormHost(host: string): boolean {
  const h = host.toLowerCase();
  return FORM_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length > 1),
  );

/**
 * How well an application page matches one of the user's recent applications, when the page
 * address isn't the stored job's (a job board's link leads to the employer's own form).
 * 0 = no match; 3 or more = the same job. Same site +3, company in the address or page +2,
 * job title +2 (most of its words on the page).
 */
export function recentApplicationScore(
  page: { url: string; title?: string; text?: string },
  job: { title: string; company: string; urls: (string | null | undefined)[] },
): number {
  let score = 0;
  let host = "";
  try {
    host = new URL(page.url).hostname.replace(/^www\./, "");
  } catch {
    return 0;
  }
  const hosts = job.urls.flatMap((u) => {
    try {
      return u ? [new URL(u).hostname.replace(/^www\./, "")] : [];
    } catch {
      return [];
    }
  });
  if (hosts.includes(host)) score += 3;

  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const company = squash(
    job.company.replace(/\b(inc|ltd|llc|gmbh|limited|corp|corporation|plc|sa|bv|ag)\b\.?/gi, ""),
  );
  const where = squash(`${page.url} ${page.title ?? ""} ${(page.text ?? "").slice(0, 3000)}`);
  if (company.length >= 3 && where.includes(company)) score += 2;

  const wanted = words(job.title);
  const seen = words(`${page.title ?? ""} ${(page.text ?? "").slice(0, 3000)}`);
  const hits = [...wanted].filter((w) => seen.has(w)).length;
  if (wanted.size > 0 && hits / wanted.size >= 0.6) score += 2;
  return score;
}
