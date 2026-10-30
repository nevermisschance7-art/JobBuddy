import { LearnedAnswers } from "@/components/forms/learned-answers";
import { AppHeader } from "@/components/app-header";
import { DeleteAccountForm, DisplayNameForm, TimeZoneForm } from "@/components/forms/account-forms";
import { AiKeysForm } from "@/components/forms/ai-keys-form";
import { CvUpload, RereadCv } from "@/components/forms/cv-upload";
import { FixedAnswersForm } from "@/components/forms/fixed-answers-form";
import { MailSetup } from "@/components/forms/mail-setup";
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
  ["learned", "Learned answers"],
  ["tone", "Tone"],
  ["extension", "Chrome extension"],
  ["mail", "Employer replies"],
  ["data", "Your data"],
] as const;

/** Built by the "Build extension" workflow and attached to the extension-latest release. */
const EXTENSION_ZIP =
  "https://github.com/nevermisschance7-art/JobBuddy/releases/download/extension-latest/jobbuddy-extension.zip";

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
  const { supabase, user, profile } = await loadProfile();
  const [cv, answers, keys, { data: learned }, { data: mailKey }] = await Promise.all([
    loadLatestCv(),
    loadFixedAnswers(),
    loadKeyStatuses(),
    supabase
      .from("learned_answers")
      .select("id, question, answer")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase.from("mail_tokens").select("last_used_at").eq("user_id", user.id).maybeSingle(),
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
            <TimeZoneForm timeZone={profile?.time_zone ?? "UTC"} />
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

        <Section id="learned" title="Learned from your forms">
          <LearnedAnswers items={learned ?? []} />
        </Section>

        <Section id="extension" title="Chrome extension">
          <Card className="flex flex-col gap-3 text-sm">
            <p>
              The extension fills application forms on any site (Greenhouse, Lever, Ashby, Workday,
              BambooHR and more) with your details, fixed answers, drafted answers and tailored CV,
              and shows your alerts. It never presses Submit: you always do.
            </p>
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              <li>
                <a href={EXTENSION_ZIP} className="underline">
                  Download the extension
                </a>{" "}
                and unzip it.
              </li>
              <li>
                In Chrome, open <code>chrome://extensions</code> and turn on Developer mode (top
                right).
              </li>
              <li>Click &quot;Load unpacked&quot; and choose the unzipped folder.</li>
              <li>
                Click the JobBuddy icon in the toolbar and sign in with your username,{" "}
                <strong>{username}</strong>.
              </li>
            </ol>
          </Card>
        </Section>

        <Section id="mail" title="Employer replies (Gmail)">
          <MailSetup connected={Boolean(mailKey)} lastUsedAt={mailKey?.last_used_at ?? null} />
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
