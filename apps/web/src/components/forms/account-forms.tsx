"use client";

import { useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { deleteAccount, saveDisplayName, setTimeZone } from "@/lib/actions/account";

export function DisplayNameForm({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState(saveDisplayName, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Display name" htmlFor="display-name">
        <Input id="display-name" name="display_name" maxLength={60} defaultValue={displayName} />
      </Field>
      <FormMessage error={state.error} ok={state.message} />
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        Save name
      </Button>
    </form>
  );
}

/** "GMT+1" for a time zone, now. */
function offsetOf(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return part ?? "";
  } catch {
    return "";
  }
}

/** Alerts and the daily summary follow this time zone. Saved as soon as one is picked. */
export function TimeZoneForm({ timeZone }: { timeZone: string }) {
  const [zone, setZone] = useState(timeZone);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const options = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    return (all.includes(timeZone) ? all : [timeZone, ...all]).map((z) => {
      const city = z.split("/").at(-1)!.replace(/_/g, " ");
      return { value: z, label: `${city} (${z.replace(/_/g, " ")}) · ${offsetOf(z)}` };
    });
  }, [timeZone]);

  const pick = async (next: string) => {
    setZone(next);
    setStatus("saving");
    const result = await setTimeZone(next);
    setStatus(result.error ? "error" : "saved");
  };

  return (
    <Field
      label="Time zone"
      htmlFor="time-zone"
      hint="Your daily summary and alerts follow this time zone. Type a city to find it."
    >
      <Combobox
        id="time-zone"
        options={options}
        value={zone}
        onChange={(z) => void pick(z)}
        ariaLabel="Time zone"
      />
      <p className="text-sm" aria-live="polite">
        {status === "saving" ? (
          <span className="text-muted-foreground">Saving...</span>
        ) : status === "saved" ? (
          <span className="text-success">Saved ✓</span>
        ) : status === "error" ? (
          <span className="text-destructive">Saving failed. Try again.</span>
        ) : null}
      </p>
    </Field>
  );
}

export function DeleteAccountForm({ username }: { username: string }) {
  const [state, action, pending] = useActionState(deleteAccount, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field
        label={`Type "${username}" to delete your account and all your data`}
        htmlFor="confirm-delete"
        hint="This removes your CV, answers, keys, matches and applications for good."
      >
        <Input id="confirm-delete" name="confirm" autoComplete="off" />
      </Field>
      <FormMessage error={state.error} />
      <Button type="submit" variant="destructive" disabled={pending} className="self-start">
        {pending ? "Deleting..." : "Delete my account"}
      </Button>
    </form>
  );
}
