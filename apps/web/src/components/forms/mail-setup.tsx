"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, FormMessage } from "@/components/ui/field";
import { createMailKey, turnOffMail } from "@/lib/actions/mail";

const when = (iso: string) =>
  new Date(iso).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Settings: the Gmail script that finds good news from employers. */
export function MailSetup({
  connected,
  lastUsedAt,
}: {
  connected: boolean;
  lastUsedAt: string | null;
}) {
  const [script, setScript] = useState<string | null>(null);
  const [on, setOn] = useState(connected);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      setError(undefined);
      const res = await createMailKey();
      if (!res.ok) return setError(res.error);
      setScript(res.script);
      setOn(true);
      setCopied(false);
    });
  const off = () =>
    startTransition(async () => {
      await turnOffMail();
      setOn(false);
      setScript(null);
    });
  const copy = async () => {
    if (!script) return;
    await navigator.clipboard?.writeText(script);
    setCopied(true);
  };

  return (
    <Card className="flex flex-col gap-3 text-sm">
      <p>
        When you apply to lots of jobs, nobody reads every reply. JobBuddy can look through your
        Gmail and point out only the good news: interviews, tests, offers and next steps. Rejections
        and &quot;we got your application&quot; mails get their own labels so you can skip them.
      </p>
      <p className="text-muted-foreground">
        A small script runs in your own Google account, so JobBuddy never gets access to your mail.
        It sends JobBuddy only the sender, subject, the first 300 characters and a link, for
        employer replies. It never deletes, archives or sends anything. You still check your mail
        yourself.
      </p>

      {on && !script ? (
        <p>
          <strong>On.</strong>{" "}
          {lastUsedAt ? `Last check: ${when(lastUsedAt)}.` : "Waiting for the first check."} Good
          news shows up as alerts, on your applications and under the label{" "}
          <strong>JobBuddy/Good news</strong> in Gmail.
        </p>
      ) : null}

      {script ? (
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>
            Open{" "}
            <a
              href="https://script.google.com/home/projects/create"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              script.google.com <ExternalLink size={12} />
            </a>{" "}
            with the Google account you apply from. It starts a new project.
          </li>
          <li>
            Delete the code that is there and paste this script.{" "}
            <Button size="sm" variant="outline" onClick={copy} type="button">
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy script"}
            </Button>
            <span className="text-muted-foreground block">
              It holds your personal mail key. Don&apos;t share it. You only see it now.
            </span>
          </li>
          <li>
            Click Save. At the top, pick <strong>setup</strong> in the list next to Debug and click
            Run.
          </li>
          <li>
            Google asks for access: choose your account. If it says the app isn&apos;t verified,
            click Advanced, then Go to the project. It is your own script, so that is expected.
          </li>
          <li>Done. It checks your mail every 15 minutes. You can close the tab.</li>
        </ol>
      ) : null}

      <FormMessage error={error} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={create} disabled={pending} variant={on ? "outline" : "default"}>
          {on ? "Make a new key" : "Create my mail key"}
        </Button>
        {on ? (
          <Button onClick={off} disabled={pending} variant="ghost">
            Turn off
          </Button>
        ) : null}
      </div>
      {on ? (
        <p className="text-muted-foreground">
          A new key stops the old script. Turn off stops it on its next run; you can also delete the
          project in script.google.com.
        </p>
      ) : null}
    </Card>
  );
}
