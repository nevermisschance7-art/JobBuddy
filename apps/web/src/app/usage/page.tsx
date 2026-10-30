import { MODELS_CONFIG } from "@jobbuddy/shared/llm";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Card } from "@/components/ui/field";
import { loadProfile } from "@/lib/data";

export const metadata = { title: "AI usage · JobBuddy" };

const PROVIDERS = [
  ["gemini", "Google Gemini", null],
  ["groq", "Groq", "GROQ_API_KEY"],
  ["cerebras", "Cerebras", "CEREBRAS_API_KEY"],
  ["mistral", "Mistral", "MISTRAL_API_KEY"],
  ["openrouter", "OpenRouter", "OPENROUTER_API_KEY"],
] as const;

/** An application uses about this many AI requests (CV, answers, one retry). */
const PER_APPLICATION = 3;

type Row = { provider: string; ok: boolean; created_at: string };

/** How many team backup keys the server has for a provider (env, comma-separated). */
function teamKeys(env: string | null): number {
  return ((env && process.env[env]) || "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 10).length;
}

export default async function UsagePage() {
  const { supabase, user, profile } = await loadProfile();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [{ data: calls }, { data: keys }] = await Promise.all([
    supabase
      .from("llm_calls")
      .select("provider,ok,created_at")
      .eq("user_id", user.id)
      .gte("created_at", startOfToday.toISOString())
      .limit(5000),
    supabase.from("ai_keys").select("provider,quota_reset_at,last_error").eq("user_id", user.id),
  ]);
  const rows = (calls ?? []) as Row[];
  const now = new Date();

  const cards = PROVIDERS.map(([id, name, env]) => {
    const own = (keys ?? []).filter((k) => k.provider === id);
    const working = own.filter((k) => !k.last_error);
    const team = teamKeys(env);
    const perKey = MODELS_CONFIG.providers[id]?.freeRequestsPerDay ?? 0;
    const today = rows.filter((r) => r.provider === id);
    const answered = today.filter((r) => r.ok).length;
    const failed = today.length - answered;
    // Your own keys' allowance; team keys are shared by everyone, so not counted as yours.
    const limit = working.length * perKey;
    const left = Math.max(0, limit - today.length);
    const resting = working.filter((k) => k.quota_reset_at && new Date(k.quota_reset_at) > now);
    return { id, name, own, working, team, limit, left, answered, failed, resting };
  });
  const totalLeft = cards.reduce((n, c) => n + c.left, 0);
  const totalLimit = cards.reduce((n, c) => n + c.limit, 0);

  return (
    <>
      <AppHeader username={profile?.username ?? null} />
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold">AI usage</h1>
          <p className="text-muted-foreground text-sm">
            Requests made for you today, and about how many your free keys still allow. Only counts
            are stored, never what was sent.
          </p>
        </div>

        <Card className="flex flex-col gap-2 p-5">
          <p className="text-sm">Left today on your own keys, about</p>
          <p className="text-3xl font-semibold tabular-nums">
            {totalLeft.toLocaleString()}{" "}
            <span className="text-muted-foreground text-base font-normal">
              requests, enough for about {Math.floor(totalLeft / PER_APPLICATION).toLocaleString()}{" "}
              applications
            </span>
          </p>
          <Meter used={totalLimit - totalLeft} limit={totalLimit} />
          <p className="text-muted-foreground text-xs">
            Limits reset daily (Google at midnight US Pacific time). When your keys are busy or used
            up, the team backups below answer instead. Add more free keys in{" "}
            <Link href="/settings#ai" className="underline">
              Settings
            </Link>
            : each account adds its own allowance.
          </p>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Card key={c.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-semibold">{c.name}</h2>
                <span className="text-muted-foreground text-xs">
                  {c.own.length
                    ? `${c.own.length} key${c.own.length === 1 ? "" : "s"} of yours`
                    : "no key of yours"}
                  {c.team ? ` · ${c.team} team` : ""}
                </span>
              </div>
              {c.limit ? (
                <>
                  <Meter used={c.limit - c.left} limit={c.limit} />
                  <p className="text-sm tabular-nums">
                    About <strong>{c.left.toLocaleString()}</strong> of {c.limit.toLocaleString()}{" "}
                    left today
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {c.team ? "Team backup only" : "Not set up"}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-1 text-sm">
                <dt className="text-muted-foreground">Answered today</dt>
                <dd className="text-right tabular-nums">{c.answered}</dd>
                <dt className="text-muted-foreground">Failed today</dt>
                <dd className="text-right tabular-nums">{c.failed}</dd>
              </dl>
              {c.own.length > c.working.length ? (
                <p className="text-destructive text-xs">
                  {c.own.length - c.working.length} key(s) stopped working: replace them in
                  Settings.
                </p>
              ) : null}
              {c.resting.length ? (
                <p className="text-muted-foreground text-xs">
                  {c.resting.length} key(s) resting after hitting a limit, back soon.
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      </main>
    </>
  );
}

function Meter({ used, limit }: { used: number; limit: number }) {
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <div
      className="bg-muted h-2 overflow-hidden rounded-full"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={used}
      aria-label="Used today"
    >
      <div
        className={share > 0.85 ? "bg-destructive h-full" : "bg-primary h-full"}
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </div>
  );
}
