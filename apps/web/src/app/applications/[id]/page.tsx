import { resumeSchema, type TruthReport } from "@jobbuddy/shared";
import { Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { AnswersPanel } from "@/components/applications/answers-panel";
import { ApplyActions } from "@/components/applications/apply-actions";
import { CvPreview } from "@/components/applications/cv-preview";
import { TailorButtons } from "@/components/applications/tailor-buttons";
import { ResumeEditor } from "@/components/forms/resume-editor";
import { MascotSays } from "@/components/mascot";
import type { StoredAnswer } from "@/lib/answers-core";
import { loadProfile } from "@/lib/data";

export const metadata = { title: "Application · JobBuddy" };

type Job = { title: string; company_name: string; apply_url: string };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await loadProfile();
  const [{ data: app }, { data: cv }] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "id, status, answers, tailored_resume_json, tailor_report, tailored_at, cv_approved_at, tailored_cv_pdf, jobs(title, company_name, apply_url)",
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("cvs")
      .select("resume_json")
      .eq("user_id", user.id)
      .eq("confirmed", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!app) notFound();

  const job = app.jobs as unknown as Job;
  const source = resumeSchema.safeParse(cv?.resume_json);
  const tailored = resumeSchema.safeParse(app.tailored_resume_json);
  const report = app.tailor_report as TruthReport | null;
  const approved = Boolean(app.cv_approved_at && app.tailored_cv_pdf);
  const answers = (Array.isArray(app.answers) ? app.answers : []) as unknown as StoredAnswer[];
  const taken = report ? [...report.removed, ...report.corrected] : [];

  const shown = tailored.success ? tailored.data : source.success ? source.data : null;

  return (
    <>
      <AppHeader username={profile?.username ?? null} />
      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <Link href="/applications" className="text-muted-foreground text-sm hover:underline">
            Back to applications
          </Link>
          <h1 className="text-2xl font-semibold">{job.title}</h1>
          <p className="text-muted-foreground">{job.company_name}</p>
        </div>

        {!source.success ? (
          <MascotSays mood="thinking">
            I only tailor from a confirmed CV.{" "}
            <Link href="/settings#cv" className="underline">
              Confirm yours in Settings
            </Link>{" "}
            first.
          </MascotSays>
        ) : (
          <>
            <section className="border-border bg-card flex flex-col gap-4 rounded-xl border p-5">
              {approved ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="flex-1 text-lg font-semibold">Your CV for this job is ready</h2>
                    <a
                      href={`/api/applications/${app.id}/cv?format=pdf`}
                      className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
                    >
                      <Download size={14} /> Download PDF
                    </a>
                    <a
                      href={`/api/applications/${app.id}/cv?format=docx`}
                      className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
                    >
                      <Download size={14} /> Download Word
                    </a>
                  </div>
                  <ApplyActions
                    applicationId={app.id}
                    applyUrl={job.apply_url}
                    status={app.status}
                  />
                  <p className="text-muted-foreground text-xs">
                    On the form, the JobBuddy extension fills your details, answers and this CV. You
                    always press Submit yourself.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-semibold">Make your CV for this job</h2>
                  <p className="text-muted-foreground text-sm">
                    The AI picks and orders what fits this job and rewords it. It can&apos;t add
                    anything: a check removes any skill, number, date or employer that isn&apos;t in
                    your CV.
                  </p>
                </>
              )}
              <TailorButtons applicationId={app.id} tailored={tailored.success} />
            </section>

            {taken.length > 0 || (report && report.gaps.length > 0) ? (
              <section className="border-border bg-card flex flex-col gap-2 rounded-xl border p-5 text-sm">
                {report && report.gaps.length > 0 ? (
                  <p>
                    <span className="font-medium">
                      The job asks for, your CV doesn&apos;t show:
                    </span>{" "}
                    {report.gaps.join(", ")}.{" "}
                    <span className="text-muted-foreground">
                      Never added for you. If you have one, add it to your CV in Settings.
                    </span>
                  </p>
                ) : null}
                {taken.length > 0 ? (
                  <details>
                    <summary className="cursor-pointer font-medium">
                      {taken.length} thing{taken.length === 1 ? "" : "s"} the AI made up, taken out
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1">
                      {taken.map((r, i) => (
                        <li key={i}>
                          <span className="font-medium">{r.section}:</span> {r.item}{" "}
                          <span className="text-muted-foreground">({r.reason})</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
            ) : null}

            {shown ? (
              <section className="border-border bg-card rounded-xl border p-5 sm:p-8">
                <CvPreview resume={shown} />
              </section>
            ) : null}

            {tailored.success ? (
              <details className="border-border bg-card rounded-xl border p-5">
                <summary className="cursor-pointer font-medium">Edit this CV</summary>
                <p className="text-muted-foreground mb-4 mt-2 text-sm">
                  Changes here are for this job only. Contact details come from your main CV.
                </p>
                <ResumeEditor
                  key={`${app.id}-${app.tailored_at}`}
                  applicationId={app.id}
                  resume={tailored.data}
                  confirmed={approved}
                />
              </details>
            ) : null}

            <details
              className="border-border bg-card rounded-xl border p-5"
              open={answers.length > 0}
            >
              <summary className="cursor-pointer font-medium">
                Answers to the form&apos;s questions{answers.length ? ` (${answers.length})` : ""}
              </summary>
              <p className="text-muted-foreground mb-4 mt-2 text-sm">
                The extension drafts these from the form itself. Paste questions here only if
                you&apos;re not using it.
              </p>
              <AnswersPanel applicationId={app.id} answers={answers} />
            </details>
          </>
        )}
      </main>
    </>
  );
}
