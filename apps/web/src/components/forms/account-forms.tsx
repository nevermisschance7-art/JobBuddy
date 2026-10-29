"use client";

import { useActionState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { deleteAccount, saveDisplayName, saveTimeZone } from "@/lib/actions/account";

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

/** Alerts and the daily summary follow this time zone. */
export function TimeZoneForm({ timeZone }: { timeZone: string }) {
  const [state, action, pending] = useActionState(saveTimeZone, initialState);
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    return all.includes(timeZone) ? all : [timeZone, ...all];
  }, [timeZone]);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field
        label="Time zone"
        htmlFor="time-zone"
        hint="Your daily summary and alerts follow this time zone."
      >
        <Select id="time-zone" name="time_zone" defaultValue={timeZone}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </Field>
      <FormMessage error={state.error} ok={state.message} />
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        Save time zone
      </Button>
    </form>
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
