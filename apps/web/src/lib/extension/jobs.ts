import "server-only";
import {
  jobKeyFromUrl,
  pageAddress,
  recentApplicationScore,
  resumeSchema,
  type JobKey,
} from "@jobbuddy/shared";
import type { StoredAnswer } from "@/lib/answers-core";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type FoundJob = {
  id: string;
  title: string;
  company_name: string;
  description_text: string;
};

const sameKey = (a: JobKey | null, b: JobKey) => a?.ats === b.ats && a.id === b.id;

/** The stored job behind an application page URL (exact id match), or null. */
export async function findJobForUrl(supabase: Supabase, url: string): Promise<FoundJob | null> {
  return (await findByKey(supabase, url)) ?? (await findByAddress(supabase, url));
}

/** Any site (Workday, company career pages...): the same page address as a stored job. */
async function findByAddress(supabase: Supabase, url: string): Promise<FoundJob | null> {
  const address = pageAddress(url);
  if (!address) return null;
  // ilike: escape its wildcards in the address, then match any query string after it.
  const pattern = `${address.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const [byCanonical, byApply] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, company_name, description_text, canonical_url, apply_url")
      .ilike("canonical_url", pattern)
      .limit(5),
    supabase
      .from("jobs")
      .select("id, title, company_name, description_text, canonical_url, apply_url")
      .ilike("apply_url", pattern)
      .limit(5),
  ]);
  const job = [...(byCanonical.data ?? []), ...(byApply.data ?? [])].find(
    (j) => pageAddress(j.canonical_url) === address || pageAddress(j.apply_url) === address,
  );
  return job
    ? {
        id: job.id,
        title: job.title,
        company_name: job.company_name,
        description_text: job.description_text,
      }
    : null;
}

async function findByKey(supabase: Supabase, url: string): Promise<FoundJob | null> {
  const key = jobKeyFromUrl(url);
  if (!key || !/^[a-z0-9-]+$/.test(key.id)) return null;
  const { data } = await supabase
    .from("jobs")
    .select("id, title, company_name, description_text, canonical_url, apply_url")
    .or(`canonical_url.ilike.*${key.id}*,apply_url.ilike.*${key.id}*`)
    .limit(10);
  const job = (data ?? []).find(
    (j) => sameKey(jobKeyFromUrl(j.canonical_url), key) || sameKey(jobKeyFromUrl(j.apply_url), key),
  );
  return job
    ? {
        id: job.id,
        title: job.title,
        company_name: job.company_name,
        description_text: job.description_text,
      }
    : null;
}

/**
 * The job behind one of the user's recent applications (last 6 hours) that this page
 * belongs to, when its address isn't the stored job's: Quick apply on a job board's link
 * lands on the employer's own form. Without this, the extension made a second application
 * (a second CV, cover letter and AI requests).
 */
export async function findRecentApplicationJob(
  supabase: Supabase,
  userId: string,
  page: { url: string; title?: string; text?: string },
): Promise<FoundJob | null> {
  const since = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const { data } = await supabase
    .from("applications")
    .select(
      "created_at, jobs!inner(id, title, company_name, description_text, apply_url, canonical_url)",
    )
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(40);
  let best: { job: FoundJob; score: number } | null = null;
  for (const row of data ?? []) {
    const j = row.jobs as unknown as FoundJob & { apply_url: string; canonical_url: string };
    const score = recentApplicationScore(page, {
      title: j.title,
      company: j.company_name,
      urls: [j.apply_url, j.canonical_url],
    });
    if (score >= 3 && (!best || score > best.score)) {
      best = {
        job: {
          id: j.id,
          title: j.title,
          company_name: j.company_name,
          description_text: j.description_text,
        },
        score,
      };
    }
  }
  return best?.job ?? null;
}

/** "GB" -> "United Kingdom". */
function countryName(code: string | undefined): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Everything the extension needs to fill a form: contact details, fixed answers and, with an
 * application, its answers and approved CV. Without one (a job not prepared yet, or any other
 * site), contact details and fixed answers still fill the basics.
 */
export async function fillData(supabase: Supabase, userId: string, applicationId: string | null) {
  const [{ data: app }, { data: cv }, { data: fixed }, { data: learned }, { data: prof }] =
    await Promise.all([
      applicationId
        ? supabase
            .from("applications")
            .select(
              "id, status, answers, tailored_cv_pdf, cv_approved_at, cover_letter_pdf, cover_letter_text",
            )
            .eq("id", applicationId)
            .eq("user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("cvs")
        .select("resume_json")
        .eq("user_id", userId)
        .eq("confirmed", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("fixed_answers")
        .select("key, value")
        .eq("user_id", userId)
        .is("applies_to_country", null),
      supabase
        .from("learned_answers")
        .select("question, answer")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(300),
      supabase.from("profiles").select("time_zone").eq("user_id", userId).maybeSingle(),
    ]);
  const timeZone = prof?.time_zone;
  if (applicationId && !app) return null;

  const resume = resumeSchema.safeParse(cv?.resume_json);
  const basics = resume.success ? resume.data.basics : null;
  const fixedAnswers = Object.fromEntries((fixed ?? []).map((f) => [f.key, f.value]));
  const name = basics?.name ?? "";
  const [first, ...rest] = name.split(/\s+/).filter(Boolean);
  // The current job: one without an end date, else the most recent.
  const work = resume.success ? resume.data.work : [];
  const current = work.find((w) => !w.endDate) ?? work[0];
  const profileUrl = (network: string) =>
    basics?.profiles.find((p) => p.network.toLowerCase().includes(network))?.url ?? null;

  const safe = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "CV";
  const file = async (path: string | null | undefined, fileName: string) => {
    if (!path) return null;
    const { data: blob } = await supabase.storage.from("cvs").download(path);
    return blob
      ? { fileName, base64: Buffer.from(await blob.arrayBuffer()).toString("base64") }
      : null;
  };
  const [cvFile, letterFile] = await Promise.all([
    app?.cv_approved_at ? file(app.tailored_cv_pdf, `${safe}-CV.pdf`) : null,
    file(app?.cover_letter_pdf, `${safe}-Cover-Letter.pdf`),
  ]);

  const answers = (Array.isArray(app?.answers) ? (app.answers as unknown as StoredAnswer[]) : [])
    .map((a) => ({
      question: a.question,
      answer: (a.final ?? a.answer ?? "").trim(),
      isCoverLetter: Boolean(a.isCoverLetter),
      // Written or picked by the AI and not yet saved by the user: shown in blue to check.
      ai: a.kind === "drafted" && a.final === undefined,
    }))
    .filter((a) => a.answer);

  return {
    applicationId: app?.id ?? null,
    status: app?.status ?? null,
    profile: {
      fullName: str(name),
      firstName: str(first),
      lastName: str(rest.join(" ")),
      email: str(basics?.email),
      phone: str(basics?.phone),
      city: str(basics?.location?.city),
      countryCode: str(basics?.location?.countryCode),
      linkedin: str(fixedAnswers.linkedin_url) ?? profileUrl("linkedin"),
      github: str(fixedAnswers.github_url) ?? profileUrl("github"),
      website: str(fixedAnswers.portfolio_url) ?? str(basics?.url),
      country: countryName(basics?.location?.countryCode),
      address: str(basics?.location?.address),
      postalCode: str(basics?.location?.postalCode),
      region: str(basics?.location?.region),
      /** Employers in the CV, to answer "Have you worked for us before?". */
      employers: work.map((w) => w.name),
      /** Work started 4+ years ago: certainly 18 or older. */
      adult: work.some(
        (w) => w.startDate && Date.parse(w.startDate) < Date.now() - 4 * 365 * 86_400_000,
      ),
      timeZone: timeZone ?? null,
      currentCompany: str(current?.name),
      currentTitle: str(current?.position),
      headline: str(basics?.label) ?? str(current?.position),
      summary: str(basics?.summary),
    },
    fixedAnswers,
    answers,
    /** What the user typed into fields JobBuddy couldn't fill before. Never sent to an AI. */
    learned: learned ?? [],
    cv: cvFile,
    /** The tailored cover letter: a PDF for upload fields, the text for text boxes. */
    coverLetter: letterFile,
    coverLetterText: app?.cover_letter_text ?? null,
  };
}
