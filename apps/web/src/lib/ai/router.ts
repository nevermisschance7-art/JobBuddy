import "server-only";
import {
  LlmRouter,
  MODELS_CONFIG,
  type KeyStore,
  type LlmSinks,
  type PersonalInfo,
  type ProviderKey,
  type ProviderName,
} from "@jobbuddy/shared/llm";
import { decryptSecret } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Router acting for the signed-in user: their keys, their usage log, their alerts. */
export function routerFor(supabase: Supabase): LlmRouter {
  const encryptionKey = serverEnv("APP_ENCRYPTION_KEY");

  const keys: KeyStore = {
    async getKeys(userId) {
      const { data } = await supabase
        .from("ai_keys")
        .select("id, provider, encrypted_key, quota_reset_at, last_error")
        .eq("user_id", userId)
        .order("created_at");
      const out: ProviderKey[] = [];
      for (const row of data ?? []) {
        // A key marked broken stays skipped until the user replaces it.
        if (row.last_error) continue;
        try {
          out.push({
            id: row.id,
            provider: row.provider as ProviderName,
            apiKey: decryptSecret(row.encrypted_key, encryptionKey),
            coolingUntil: row.quota_reset_at ? new Date(row.quota_reset_at) : null,
          });
        } catch {
          console.error(`Could not decrypt ${row.provider} key for user ${userId}`);
        }
      }
      return out;
    },
    async markCoolingDown(userId, provider, until, _error, keyId) {
      const q = supabase
        .from("ai_keys")
        .update({ quota_reset_at: until.toISOString() })
        .eq("user_id", userId);
      await (keyId ? q.eq("id", keyId) : q.eq("provider", provider));
    },
    async markBroken(userId, provider, error, keyId) {
      const q = supabase
        .from("ai_keys")
        .update({ last_error: `This key stopped working: ${error.slice(0, 200)}` })
        .eq("user_id", userId);
      await (keyId ? q.eq("id", keyId) : q.eq("provider", provider));
    },
  };

  const sinks: LlmSinks = {
    async logCall(e) {
      await supabase.from("llm_calls").insert({
        user_id: e.userId,
        task: e.task,
        provider: e.provider,
        model: e.model,
        input_tokens: e.inputTokens,
        output_tokens: e.outputTokens,
        latency_ms: e.latencyMs,
        ok: e.ok,
        error_kind: e.errorKind,
        error_message: e.errorMessage,
      });
    },
    async needsFixing(userId, message) {
      // At most one unread "needs fixing" alert per day.
      const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
      const { count } = await supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("type", "needs_fixing")
        .eq("read", false)
        .gte("created_at", since);
      if (!count) {
        await supabase
          .from("events")
          .insert({ user_id: userId, type: "needs_fixing", payload: { message } });
      }
    },
  };

  // Team backups, used after the user's own keys (so a busy Gemini doesn't stop anyone).
  // Each env value may list several keys, comma-separated: their limits add up.
  const list = (v: string | undefined) =>
    (v ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 10);
  const sharedKeys: Partial<Record<ProviderName, string[]>> = {
    groq: list(process.env.GROQ_API_KEY),
    cerebras: list(process.env.CEREBRAS_API_KEY),
    mistral: list(process.env.MISTRAL_API_KEY),
    openrouter: list(process.env.OPENROUTER_API_KEY),
  };
  if (MODELS_CONFIG.providers.anthropic.enabled && process.env.ANTHROPIC_API_KEY) {
    sharedKeys.anthropic = [process.env.ANTHROPIC_API_KEY];
  }

  return new LlmRouter({ keys, sinks, sharedKeys });
}

/** Personal details to keep out of prompts: from the confirmed CV and the fixed answers. */
export async function personalInfoFor(supabase: Supabase, userId: string): Promise<PersonalInfo> {
  const [{ data: cv }, { data: answers }] = await Promise.all([
    supabase
      .from("cvs")
      .select("resume_json")
      .eq("user_id", userId)
      .eq("confirmed", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("fixed_answers").select("value").eq("user_id", userId),
  ]);
  const basics = (cv?.resume_json as { basics?: Record<string, unknown> } | null)?.basics ?? {};
  const location = (basics.location ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    name: str(basics.name),
    email: str(basics.email),
    phone: str(basics.phone),
    address: str(location.address),
    fixedAnswers: (answers ?? []).map((a) => a.value),
  };
}
