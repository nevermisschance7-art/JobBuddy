import "server-only";
import { jobKeyFromUrl, resumeSchema, type JobKey } from "@jobbuddy/shared";
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

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Everything the extension needs to fill a form: contact details, fixed answers, answers, CV. */
export async function fillData(supabase: Supabase, userId: string, applicationId: string) {
  const [{ data: app }, { data: cv }, { data: fixed }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, status, answers, tailored_cv_pdf, cv_approved_at")
      .eq("id", applicationId)
      .eq("user_id", userId)
      .maybeSingle(),
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
  ]);
  if (!app) return null;

  const resume = resumeSchema.safeParse(cv?.resume_json);
  const basics = resume.success ? resume.data.basics : null;
  const fixedAnswers = Object.fromEntries((fixed ?? []).map((f) => [f.key, f.value]));
  const name = basics?.name ?? "";
  const [first, ...rest] = name.split(/\s+/).filter(Boolean);
  const profileUrl = (network: string) =>
    basics?.profiles.find((p) => p.network.toLowerCase().includes(network))?.url ?? null;

  let cvFile: { fileName: string; base64: string } | null = null;
  if (app.tailored_cv_pdf && app.cv_approved_at) {
    const { data: blob } = await supabase.storage.from("cvs").download(app.tailored_cv_pdf);
    if (blob) {
      const safe = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "CV";
      cvFile = {
        fileName: `${safe}-CV.pdf`,
        base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
      };
    }
  }

  const answers = (Array.isArray(app.answers) ? (app.answers as unknown as StoredAnswer[]) : [])
    .map((a) => ({
      question: a.question,
      answer: (a.final ?? a.answer ?? "").trim(),
      isCoverLetter: Boolean(a.isCoverLetter),
    }))
    .filter((a) => a.answer);

  return {
    applicationId: app.id,
    status: app.status,
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
    },
    fixedAnswers,
    answers,
    cv: cvFile,
  };
}
