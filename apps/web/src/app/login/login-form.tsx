"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { signInWithUsername } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signInWithUsername, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="Username"
        required
        htmlFor="username"
        hint="New name? I'll make you an account. Used it before? You're back in."
      >
        <Input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={3}
          maxLength={30}
          placeholder="e.g. sam-dev"
        />
      </Field>
      <FormMessage error={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Continue"}
      </Button>
    </form>
  );
}
