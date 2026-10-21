import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Card } from "@/components/ui/field";
import { loadProfile } from "@/lib/data";

export const metadata = { title: "AI usage · JobBuddy" };

const PROVIDERS = [
  ["gemini", "Google Gemini"],
  ["groq", "Groq"],
  ["openrouter", "OpenRouter"],
] as const;

type Row = {
  provider: string;
  ok: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
};

export default async function UsagePage() {
  const { supabase, user, profile } = await loadProfile();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: calls }, { data: keys }] = await Promise.all([
    supabase
      .from("llm_calls")
      .select("provider,ok,input_tokens,output_tokens,created_at")
      .eq("user_id", user.id)
      .gte("created_at", since),
    supabase.from("ai_keys").select("provider,quota_reset_at,last_error").eq("user_id", user.id),
  ]);
  const rows = (calls ?? []) as Row[];
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const now = new Date();

  return (
    <>
      <AppHeader username={profile?.username ?? null} />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold">AI usage</h1>
          <p className="text-sm text-muted-foreground">
            Calls made with your keys. Only counts are stored, never what was sent.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {PROVIDERS.map(([id, name]) => {
            const key = keys?.find((k) => k.provider === id);
            const mine = rows.filter((r) => r.provider === id);
            const today = mine.filter((r) => new Date(r.created_at) >= startOfToday);
            const failed = today.filter((r) => !r.ok).length;
            const tokens = today.reduce(
              (n, r) => n + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
              0,
            );
            const cooling = key?.quota_reset_at && new Date(key.quota_reset_at) > now;
            const status = !key
              ? { label: "No key", tone: "text-muted-foreground" }
              : key.last_error
                ? { label: "Needs fixing", tone: "text-destructive" }
                : cooling
                  ? {
                      label: `Resting until ${new Date(key.quota_reset_at as string).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
                      tone: "text-warning",
                    }
                  : { label: "Working", tone: "text-success" };
            return (
              <Card key={id} className="flex flex-col gap-2 p-4">
                <h2 className="font-semibold">{name}</h2>
                <p className={`text-sm font-medium ${status.tone}`}>{status.label}</p>
                <dl className="grid grid-cols-2 gap-1 text-sm">
                  <dt className="text-muted-foreground">Calls today</dt>
                  <dd className="text-right tabular-nums">{today.length}</dd>
                  <dt className="text-muted-foreground">Failed today</dt>
                  <dd className="text-right tabular-nums">{failed}</dd>
                  <dt className="text-muted-foreground">Tokens today</dt>
                  <dd className="text-right tabular-nums">{tokens.toLocaleString()}</dd>
                  <dt className="text-muted-foreground">Last 7 days</dt>
                  <dd className="text-right tabular-nums">{mine.length}</dd>
                </dl>
                {key?.last_error ? (
                  <p className="text-xs text-destructive">{key.last_error}</p>
                ) : null}
              </Card>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">
          Add or replace keys in{" "}
          <Link href="/settings#ai" className="underline">
            Settings
          </Link>
          .
        </p>
      </main>
    </>
  );
}
