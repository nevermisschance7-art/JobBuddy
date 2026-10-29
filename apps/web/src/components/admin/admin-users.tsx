"use client";

import { Download } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { adminSignIn, adminUserAction, type AdminAction } from "@/lib/actions/admin";

export type AdminUserRow = {
  id: string;
  username: string;
  joined: string;
  lastActive: string | null;
  applications: number;
  hasCv: boolean;
  disabled: boolean;
};

export function AdminPassword() {
  const [state, action, pending] = useActionState(adminSignIn, initialState);
  return (
    <form action={action} className="flex max-w-sm flex-col gap-3">
      <label htmlFor="admin-password" className="text-sm font-medium">
        Admin password
      </label>
      <Input id="admin-password" name="password" type="password" required autoFocus />
      <FormMessage error={state.error} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Checking..." : "Open admin"}
      </Button>
    </form>
  );
}

const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })
    : "never";

function Row({ user, self }: { user: AdminUserRow; self: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (action: AdminAction) => {
    if (
      action === "delete" &&
      !confirm(`Delete ${user.username} and all their data? This can't be undone.`)
    )
      return;
    startTransition(async () => setMessage(await adminUserAction(user.id, action)));
  };

  return (
    <tr className="border-border border-t align-middle">
      <td className="py-2 pr-3 font-medium">
        {user.username}
        {user.disabled ? (
          <span className="bg-destructive/15 text-destructive ml-2 rounded-full px-2 py-0.5 text-xs">
            Disabled
          </span>
        ) : null}
      </td>
      <td className="py-2 pr-3">{date(user.joined)}</td>
      <td className="py-2 pr-3">{date(user.lastActive)}</td>
      <td className="py-2 pr-3 tabular-nums">{user.applications}</td>
      <td className="py-2 pr-3">
        {user.hasCv ? (
          <a
            href={`/api/admin/cv/${user.id}`}
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            <Download size={14} /> CV
          </a>
        ) : (
          <span className="text-muted-foreground">none</span>
        )}
      </td>
      <td className="py-2">
        {self ? (
          <span className="text-muted-foreground text-xs">you</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {user.disabled ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run("enable")}>
                Enable
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run("disable")}>
                Disable
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run("kick")}>
              Kick
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => run("delete")}
            >
              Delete
            </Button>
            {message ? <span className="text-muted-foreground text-xs">{message}</span> : null}
          </div>
        )}
      </td>
    </tr>
  );
}

export function AdminUsers({ users, selfId }: { users: AdminUserRow[]; selfId: string }) {
  return (
    <div className="border-border bg-card overflow-x-auto rounded-xl border p-4">
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground text-xs uppercase">
          <tr>
            <th className="pb-2 pr-3">User</th>
            <th className="pb-2 pr-3">Joined</th>
            <th className="pb-2 pr-3">Last active</th>
            <th className="pb-2 pr-3">Applications</th>
            <th className="pb-2 pr-3">Uploaded CV</th>
            <th className="pb-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <Row key={u.id} user={u} self={u.id === selfId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
