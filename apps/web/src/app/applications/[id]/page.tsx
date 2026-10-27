import { resumeSchema, type TruthReport } from "@jobbuddy/shared";
import { Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { AnswersPanel } from "@/components/applications/answers-panel";
import { CvPreview } from "@/components/applications/cv-preview";
import { TailorButtons } from "@/components/applications/tailor-buttons";
import { ResumeEditor } from "@/components/forms/resume-editor";
import { MascotSays } from "@/components/mascot";
import { Card } from "@/components/ui/field";
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

  return (
    <>
      <AppHeader username={profile?.username ?? null} />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-1">
          <Link href="/applications" className="text-muted-foreground text-sm hover:underline">
            Back to applications
          </Link>
          <h1 className="text-2xl font-semibold">{job.title}</h1>
          <p className="text-muted-foreground">
            {job.company_name} ·{" "}
            <a href={job.apply_url} target="_blank" rel="noreferrer" className="underline">
              Open the job <ExternalLink size={12} className="inline" />
            </a>
          </p>
        </div>

        {!source.success ? (
          <MascotSays mood="thinking">
            I only tailor from a confirmed CV.{" "}
            <Link href="/settings" className="underline">
              Confirm yours in Settings
            </Link>{" "}
            first.
          </MascotSays>
        ) : (
          <>
            <Card className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">1. Your CV for this job</h2>
              <p className="text-muted-foreground text-sm">
                The AI picks and orders what fits this job and rewords it. It can&apos;t add
                anything: a check removes any skill, number, date or employer that isn&apos;t in
                your confirmed CV.
              </p>
              <TailorButtons applicationId={app.id} tailored={tailored.success} />
            </Card>

            {taken.length > 0 ? (
              <Card className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">
                  Taken out because it isn&apos;t in your CV
                </h2>
                <ul className="flex flex-col gap-1 text-sm">
                  {taken.map((r, i) => (
                    <li key={i}>
                      <span className="font-medium">{r.section}:</span> {r.item}{" "}
                      <span className="text-muted-foreground">({r.reason})</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {report && report.gaps.length > 0 ? (
              <Card className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">
                  The job asks for these, your CV doesn&apos;t show them
                </h2>
                <p className="text-sm">{report.gaps.join(", ")}</p>
                <p className="text-muted-foreground text-xs">
                  I never add these for you. If you really have one, add it to your main CV in
                  Settings, then tailor again.
                </p>
              </Card>
            ) : null}

            {tailored.success ? (
              <>
                <details className="border-border bg-card rounded-xl border p-4">
                  <summary className="cursor-pointer font-medium">
                    Compare with your original CV
                  </summary>
                  <div className="mt-4 grid gap-6 md:grid-cols-2">
                    <div>
                      <p className="text-muted-foreground mb-2 text-xs uppercase">Original</p>
                      <CvPreview resume={source.data} />
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-2 text-xs uppercase">For this job</p>
                      <CvPreview resume={tailored.data} />
                    </div>
                  </div>
                </details>

                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-semibold">2. Check and approve</h2>
                  <p className="text-muted-foreground text-sm">
                    Edit anything below. Contact details always come from your main CV.
                  </p>
                </div>
                <ResumeEditor
                  key={`${app.id}-${app.tailored_at}`}
                  applicationId={app.id}
                  resume={tailored.data}
                  confirmed={approved}
                />
              </>
            ) : null}

            {approved ? (
              <Card className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">3. Your files</h2>
                <div className="flex flex-wrap gap-4 text-sm">
                  <a href={`/api/applications/${app.id}/cv?format=pdf`} className="underline">
                    <Download size={14} className="inline" /> Download PDF
                  </a>
                  <a href={`/api/applications/${app.id}/cv?format=docx`} className="underline">
                    <Download size={14} className="inline" /> Download Word
                  </a>
                </div>
                <p className="text-muted-foreground text-xs">
                  You still apply yourself: open the job, upload the file and press Submit.
                </p>
              </Card>
            ) : null}

            <AnswersPanel applicationId={app.id} answers={answers} />
          </>
        )}
      </main>
    </>
  );
}
