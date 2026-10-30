"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Field, FormMessage, Input } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { removeAiKey, saveAiKey } from "@/lib/actions/onboarding";

type Provider = "gemini" | "groq" | "cerebras" | "mistral" | "openrouter";

export type SavedKey = {
  id: string;
  /** The key's last 4 characters, to tell keys apart. */
  hint: string | null;
  lastError: string | null;
  /** Hit its limit and resting until the provider resets it. */
  resting: boolean;
};
export type KeyStatus = { provider: Provider; keys: SavedKey[] };

const MAX_KEYS = 5;

const INFO: Record<Provider, { name: string; required: boolean; steps: React.ReactNode }> = {
  gemini: {
    name: "Google Gemini",
    required: true,
    steps: (
      <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
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
        <li>
          Copy the key and paste it here. Each Google account has its own free daily allowance, so
          keys from 2 or 3 accounts give you 2 or 3 times as much.
        </li>
      </ol>
    ),
  },
  groq: {
    name: "Groq (optional backup)",
    required: false,
    steps: (
      <p className="text-muted-foreground text-sm">
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
  cerebras: {
    name: "Cerebras (optional backup)",
    required: false,
    steps: (
      <p className="text-muted-foreground text-sm">
        Free key at{" "}
        <a className="underline" href="https://cloud.cerebras.ai" target="_blank" rel="noreferrer">
          cloud.cerebras.ai
        </a>{" "}
        (API Keys). Fast, with a large free allowance per minute.
      </p>
    ),
  },
  mistral: {
    name: "Mistral (optional backup)",
    required: false,
    steps: (
      <p className="text-muted-foreground text-sm">
        Free key at{" "}
        <a
          className="underline"
          href="https://console.mistral.ai/api-keys"
          target="_blank"
          rel="noreferrer"
        >
          console.mistral.ai
        </a>{" "}
        (choose the free Experiment plan).
      </p>
    ),
  },
  openrouter: {
    name: "OpenRouter (optional backup)",
    required: false,
    steps: (
      <p className="text-muted-foreground text-sm">
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
  const full = status.keys.length >= MAX_KEYS;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{info.name}</h2>
        {status.keys.length ? (
          <span className="bg-muted rounded-full px-3 py-1 text-xs">
            {status.keys.length} key{status.keys.length === 1 ? "" : "s"} saved
          </span>
        ) : null}
      </div>
      {info.steps}
      {status.keys.length ? (
        <ul className="flex flex-col gap-2">
          {status.keys.map((k) => (
            <li
              key={k.id}
              className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
            >
              <span className="font-mono">••••{k.hint ?? "????"}</span>
              <span
                className={k.lastError ? "text-destructive flex-1" : "text-muted-foreground flex-1"}
              >
                {k.lastError
                  ? "Stopped working: remove it and add a new one"
                  : k.resting
                    ? "Resting: hit its limit, back soon"
                    : "Working"}
              </span>
              <form action={removeAiKey}>
                <input type="hidden" name="key_id" value={k.id} />
                <Button type="submit" variant="ghost" size="sm">
                  Remove
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      {full ? (
        <p className="text-muted-foreground text-sm">
          That&apos;s the most keys here ({MAX_KEYS}).
        </p>
      ) : (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="provider" value={status.provider} />
          <Field
            label={status.keys.length ? "Add another key" : "API key"}
            htmlFor={`key-${status.provider}`}
          >
            <Input
              id={`key-${status.provider}`}
              name="key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste key"
            />
          </Field>
          <FormMessage error={state.error} ok={state.message} />
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Checking key..." : "Check and save"}
          </Button>
        </form>
      )}
    </Card>
  );
}

export function AiKeysForm({ statuses }: { statuses: KeyStatus[] }) {
  return (
    <div className="flex flex-col gap-4">
      {statuses.map((s) => (
        <ProviderKey key={s.provider} status={s} />
      ))}
      <p className="text-muted-foreground text-xs">
        Keys are encrypted before they&apos;re stored and are only used on the server. They&apos;re
        never shown again, not even to you.
      </p>
    </div>
  );
}
