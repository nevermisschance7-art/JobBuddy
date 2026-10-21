"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Field, FormMessage, Input } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { removeAiKey, saveAiKey } from "@/lib/actions/onboarding";

type Provider = "gemini" | "groq" | "openrouter";

export type KeyStatus = { provider: Provider; saved: boolean; lastError: string | null };

const INFO: Record<Provider, { name: string; required: boolean; steps: React.ReactNode }> = {
  gemini: {
    name: "Google Gemini",
    required: true,
    steps: (
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Open{" "}
          <a
            className="underline"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
          >
            Google AI Studio
          </a>{" "}
          and sign in with Google.
        </li>
        <li>Click &quot;Create API key&quot;.</li>
        <li>Copy the key and paste it here.</li>
      </ol>
    ),
  },
  groq: {
    name: "Groq (optional backup)",
    required: false,
    steps: (
      <p className="text-sm text-muted-foreground">
        Free key at{" "}
        <a
          className="underline"
          href="https://console.groq.com/keys"
          target="_blank"
          rel="noreferrer"
        >
          console.groq.com/keys
        </a>
        . Used when Gemini is busy.
      </p>
    ),
  },
  openrouter: {
    name: "OpenRouter (optional backup)",
    required: false,
    steps: (
      <p className="text-sm text-muted-foreground">
        Free key at{" "}
        <a className="underline" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
          openrouter.ai/keys
        </a>
        . Last resort when the others are out of quota.
      </p>
    ),
  },
};

function ProviderKey({ status }: { status: KeyStatus }) {
  const [state, action, pending] = useActionState(saveAiKey, initialState);
  const info = INFO[status.provider];

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{info.name}</h2>
        {status.saved ? (
          <span className="rounded-full bg-muted px-3 py-1 text-xs">
            {status.lastError ? "Needs fixing" : "Saved ✓"}
          </span>
        ) : null}
      </div>
      {info.steps}
      {status.lastError ? <FormMessage error={status.lastError} /> : null}
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="provider" value={status.provider} />
        <Field label={status.saved ? "Replace key" : "API key"} htmlFor={`key-${status.provider}`}>
          <Input
            id={`key-${status.provider}`}
            name="key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={status.saved ? "••••••••  (saved, hidden)" : "Paste key"}
          />
        </Field>
        <FormMessage error={state.error} ok={state.message} />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Checking key..." : "Check and save"}
          </Button>
          {status.saved ? (
            <Button type="submit" variant="ghost" formAction={removeAiKey}>
              Remove
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

export function AiKeysForm({ statuses }: { statuses: KeyStatus[] }) {
  return (
    <div className="flex flex-col gap-4">
      {statuses.map((s) => (
        <ProviderKey key={s.provider} status={s} />
      ))}
      <p className="text-xs text-muted-foreground">
        Keys are encrypted before they&apos;re stored and are only used on the server. They&apos;re
        never shown again, not even to you.
      </p>
    </div>
  );
}
