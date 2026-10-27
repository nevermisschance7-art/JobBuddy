import { AppHeader } from "@/components/app-header";
import { DeleteAccountForm, DisplayNameForm } from "@/components/forms/account-forms";
import { AiKeysForm } from "@/components/forms/ai-keys-form";
import { CvUpload, RereadCv } from "@/components/forms/cv-upload";
import { FixedAnswersForm } from "@/components/forms/fixed-answers-form";
import { ResumeEditor } from "@/components/forms/resume-editor";
import { ToneForm } from "@/components/forms/tone-form";
import { Card } from "@/components/ui/field";
import { loadProfile } from "@/lib/data";
import { loadFixedAnswers, loadKeyStatuses, loadLatestCv } from "@/lib/loaders";

export const metadata = { title: "Settings · JobBuddy" };

const SECTIONS = [
  ["account", "Account"],
  ["cv", "CV"],
  ["answers", "Fixed answers"],
  ["ai", "AI keys"],
  ["tone", "Tone"],
  ["data", "Your data"],
] as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const { profile } = await loadProfile();
  const [cv, answers, keys] = await Promise.all([
    loadLatestCv(),
    loadFixedAnswers(),
    loadKeyStatuses(),
  ]);
  const username = profile?.username ?? "";

  return (
    <>
      <AppHeader username={username} />
      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold">Settings</h1>
          <nav className="flex flex-wrap gap-2 text-sm">
            {SECTIONS.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="bg-muted rounded-full px-3 py-1 hover:underline"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        <Section id="account" title="Account">
          <Card className="flex flex-col gap-3">
            <p className="text-sm">
              Username: <strong>{username}</strong>
            </p>
            <DisplayNameForm displayName={profile?.display_name ?? username} />
          </Card>
        </Section>

        <Section id="cv" title="CV">
          <Card>
            <CvUpload hasCv={Boolean(cv)} />
            {cv?.original_file ? <RereadCv cvId={cv.id} /> : null}
          </Card>
          {cv ? (
            <ResumeEditor
              key={`${cv.id}-${cv.updated_at}`}
              cvId={cv.id}
              resume={cv.resume}
              confirmed={cv.confirmed}
            />
          ) : null}
        </Section>

        <Section id="answers" title="Fixed answers">
          <FixedAnswersForm values={answers} />
        </Section>

        <Section id="ai" title="AI keys">
          <AiKeysForm statuses={keys} />
        </Section>

        <Section id="tone" title="Tone">
          <ToneForm tone={profile?.tone ?? "kind"} />
        </Section>

        <Section id="data" title="Your data">
          <Card className="flex flex-col gap-3">
            <p className="text-sm">
              Download everything I store about you: your CV files and all your data as JSON.
            </p>
            <a
              href="/api/export"
              className="border-border hover:bg-muted self-start rounded-md border px-4 py-2 text-sm"
            >
              Export my data
            </a>
          </Card>
          <Card className="border-destructive/40">
            <DeleteAccountForm username={username} />
          </Card>
        </Section>
      </main>
    </>
  );
}
